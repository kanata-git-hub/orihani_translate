# 음성 번역 비교 준비

운영 앱과 분리된 검사 도구입니다. 앱의 모델·화면·배포 설정을 변경하지 않습니다.
실제 API 비교는 아직 실행하지 않았습니다. 로컬 모의 검사 통과가 번역 품질이나 속도 우위를 뜻하지 않습니다.

## 비교 대상과 방식

- 기준: 현재 앱의 `/live`에 같은 녹음 파일을 전송합니다. 코드 검토 기준 커밋은 `94cea53`이며, `gemini-3.6-flash` 번역과 `gemini-3.1-flash-tts-preview` 음성 출력을 사용합니다. 실측 전 최신 코드와 배포를 다시 확인하세요.
- 후보: `gpt-realtime-translate`에 동일 PCM을 실제 발화 속도로 보내고, 정지 시 `session.close`를 보냅니다. `session.closed`까지 남은 음성과 문자를 모두 받아 저장합니다.
- 후보 음성이 말하는 도중 도착하더라도 정지까지 보관하는 워키토키 방식을 계산합니다. 단순히 음소거했다가 해제해서 앞부분이 사라지는 방식이 아닙니다.
- 두 연결 모두 준비된 뒤 측정합니다. 연결 준비 시간은 별도 `setupMs`입니다. 기준 앱의 녹음 종료·파일 변환 시간과 실물 휴대폰의 재생 지연은 포함되지 않습니다.
- 기본 비교에는 이전 대화 문맥을 넣지 않습니다. 현재 Gemini의 문맥 기능과 OpenAI의 연속 대화 문맥 차이는 별도의 실제 대화 시험이 필요합니다.

## 실행

### Google Cloud Shell에서 숨김 입력으로 실행

이 도구는 사용자의 Cloud Shell에서 실행됩니다. Cloud Shell에 입력한 키나 생성된 결과가 Codex 작업 환경에 자동으로 전달되지는 않습니다. 키 대신 결과 파일만 대화에 첨부하세요. 운영 Cloud Run의 환경 변수나 Secret Manager를 바꿀 필요는 없습니다.

1. [비교용 Cloud Shell 열기](https://shell.cloud.google.com/?cloudshell_git_repo=https://github.com/kanata-git-hub/orihani_translate&cloudshell_git_branch=chore/voice-translation-benchmark&cloudshell_workspace=.&show=terminal)를 누릅니다. 이 링크는 별도 임시 환경을 열 수 있으므로 결과는 세션 종료 전에 다운로드하세요.
2. 30초 이내의 본인 녹음을 업로드합니다. Cloud Shell의 **더보기(⋮) → 업로드**에서 파일을 선택하고 업로드된 전체 경로를 확인합니다. 녹음을 `voice.m4a`라는 이름으로 홈 폴더에 올리면 기본 경로를 그대로 쓸 수 있습니다.
3. 저장소 폴더의 터미널에서 아래 명령을 실행하고 녹음 경로, 번역 방향, 키를 차례로 입력합니다. 키는 마지막 숨김 입력에만 붙여넣고 Enter를 누릅니다.

```sh
bash scripts/voice-benchmark/cloud-shell.sh
```

필요한 npm 의존성은 키 입력 전에 설치합니다. 기존 WAV가 지원 형식이면 그대로 사용하고, 그 외 형식은 ffmpeg로 변환합니다. ffmpeg가 없는 경우 설치 명령을 안내하고 API 호출 전에 종료합니다. 30초를 넘는 녹음은 자동으로 잘라 비교하지 않고 거부합니다. Node 20 이상이 필요하며 이 저장소에서 검증한 실행 환경은 Node 24입니다.

키는 실행 중인 자식 프로세스에만 전달하며 입력을 화면에 표시하거나 키 파일을 만들지 않습니다. 실행은 각 제공자에 1회 요청하며 실제 API 사용료가 발생합니다. **키와 비용이 연결된 실측은 아직 실행하지 않았습니다.**

종료 시 표시되는 결과 폴더에서 `report.json`, `source.wav`, `baseline.wav`, `openai.wav`를 Cloud Shell의 **더보기(⋮) → 다운로드**로 받아 대화에 첨부하세요. 일부 제공자가 실패하면 존재하는 결과와 오류 메시지만 보내세요. 비교 파일에는 녹음과 번역문이 들어 있으므로 공개 GitHub에 올리지 마세요. 첫 1회 결과는 연결 확인이며 품질·속도의 최종 판정은 여러 문장과 반복 측정이 필요합니다.

Google 공식 안내: [파일 업로드·다운로드](https://docs.cloud.google.com/shell/docs/uploading-and-downloading-files), [저장소를 Cloud Shell에서 열기](https://docs.cloud.google.com/shell/docs/open-in-cloud-shell).

### 준비된 서버 환경에서 직접 실행

Node 24와 저장소의 기존 `npm ci` 의존성만 사용합니다. OpenAI SDK 추가 설치는 필요하지 않습니다.
서버 또는 실행 환경의 비밀 설정에서 `OPENAI_API_KEY`를 연결해야 합니다. 키를 소스·명령행 인수·채팅·공개 GitHub에 넣지 마세요. 발급만 받은 키는 이 작업에 자동 연결되지 않습니다.

입력은 최대 30초, 24 kHz, 모노, PCM16 WAV입니다. 필요하면 로컬에서 변환합니다.

```sh
ffmpeg -i input.m4a -ar 24000 -ac 1 -c:a pcm_s16le input.wav

# 사전 검사만 수행합니다. 과금 API를 호출하지 않습니다.
node scripts/voice-benchmark/run.mjs --audio input.wav --source ko --target ja

# 키 연결 후 실제 비교: 각 제공자에 한 번씩 요청합니다.
node scripts/voice-benchmark/run.mjs --audio input.wav --source ko --target ja --run
```

반대 방향은 `--source ja --target ko`로 실행합니다. 순서 효과를 줄이려면 다음 반복에 `--openai-first`를 사용합니다. 동일 문장을 최소 3회씩 비교하고, 여러 문장의 중앙값과 느린 사례를 함께 확인합니다.
키가 없으면 두 제공자 모두 호출하기 전에 종료합니다. 도구 자체는 실패한 요청을 자동 재시도하지 않습니다. 기존 Gemini 서버의 재시도 정책은 그대로 적용됩니다.

결과는 이 폴더의 Git 제외 대상인 `results/날짜/`에 저장합니다. `source.wav`, 두 제공자의 출력 WAV, 번역문과 시간 정보를 담은 `report.json`은 공개 저장소에 올리지 마세요. 입력을 이 폴더에 보관할 때는 Git 제외 대상인 `inputs/`를 사용하세요.

## 판정

1. **품질**: 같은 원음과 두 출력 음성을 익명 순서로 듣고 의미·부정·숫자·고유명사·조건절·말투·문장 끝 누락을 비교합니다. 일본어와 한국어 양방향 모두 확인합니다. 평균이 비슷해도 중요한 내용을 자주 틀리면 채택하지 않습니다.
2. **속도**: 정지부터 첫 음성 패킷, 첫 재생 예약, 신호가 포함된 샘플의 예상 재생, 전체 수신 완료까지 각각 기록합니다. 첫 패킷 도착만으로 체감 속도가 빨라졌다고 판단하지 않습니다. 초기 채택 기준안은 같은 입력에서 중앙값 30% 이상 단축, 현재 약 5초인 사용 상황에서 3초 이내 재생 시작입니다. 이는 목표이며 실측 결과가 아닙니다.
3. **끊김**: 현재 앱의 150ms 초기 버퍼와 50ms 보충 기준을 적용했을 때 생기는 추가 재생 간격을 계산합니다. `hindsightMinimumStartDelayMs`는 모든 패킷을 받은 뒤 계산한 이론적 최소 대기 시간이며, 실시간으로 미리 알 수 있는 값이 아닙니다. WAV는 받은 음성을 순서대로 이어 붙인 것으로 네트워크 간격은 포함하지 않습니다. 자연스러운 쉼과 모델의 발화 중단은 직접 듣고 판단해야 합니다. 최종 판단에는 실제 휴대폰·Wi-Fi·이동통신에서의 검사가 필요합니다.

검사 문장에는 주문 변경, “하지 말아 주세요”, 날짜·시각·인원수·가격, 역·호텔 이름, 문장 끝에서 뜻이 바뀌는 조건, 일본어가 섞인 한국어, 짧은 침묵 뒤 이어 말하기를 포함합니다.

## 공식 문서에서 확인한 제약

- 한국어·일본어 입출력 지원. 번역과 음성이 함께 생성됩니다.
- 번역 전용 세션은 일반 Realtime 대화 세션과 다르며 `response.create`를 사용하지 않습니다.
- 사용자 지정 프롬프트·용어집·발음 안내를 지원하지 않습니다. 고유명사 오역 가능성과 출력 언어가 섞인 구간에서 번역 음성이 생략되는 동작을 따로 시험해야 합니다.
- 출력이 완전히 도착하기 전에 연결을 닫으면 끝부분을 잃을 수 있습니다.
- 공식 가격은 음성 분당 $0.034입니다. 실제 사용량과 비용은 API 사용 내역으로 확인합니다.

출처(2026-09-13 확인):

- https://developers.openai.com/api/docs/guides/realtime-translation
- https://developers.openai.com/cookbook/examples/voice_solutions/realtime_translation_guide
- https://developers.openai.com/api/docs/models/gpt-realtime-translate

```sh
node --test tests/voiceBenchmark.test.mjs
```
