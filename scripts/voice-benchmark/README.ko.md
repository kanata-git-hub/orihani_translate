# 음성 번역 비교 준비

운영 앱과 분리된 검사 도구입니다. 앱의 모델·화면·배포 설정을 변경하지 않습니다.
`audio_received`는 음성 데이터 수신 완료이며 번역 성공 판정이 아닙니다. 로컬 모의 검사 통과도 번역 품질이나 속도 우위를 뜻하지 않습니다.

## 비교 대상과 방식

- 기준: 현재 앱의 `/live`에 같은 녹음 파일을 전송합니다. 코드 검토 기준 커밋은 `94cea53`이며, `gemini-3.6-flash` 번역과 `gemini-3.1-flash-tts-preview` 음성 출력을 사용합니다. 실측 전 최신 코드와 배포를 다시 확인하세요.
- 후보: `gpt-realtime-translate`에 동일 PCM을 실제 발화 속도로 보내고, 정지 시 `session.close`를 보냅니다. `session.closed`까지 남은 음성과 문자를 모두 받아 저장합니다.
- 입력은 권장 길이인 200ms 단위로 전송하고 마지막 남은 샘플도 보존합니다. `transport`에는 입력과 전송 큐에 넣은 PCM의 해시·크기, 서버의 모델·출력 언어, 종료 확인 여부를 기록합니다. 전송 큐 기록만으로 서버의 음성 인식 성공을 보장하지는 않습니다.
- 출력 이벤트에 `sample_rate`, `channels`, `format`이 있으면 WAV 저장과 재생 시간 계산에 반영합니다. 없으면 24kHz 모노 PCM16을 기본값으로 쓰고 `outputFormat`의 선언 여부를 기록합니다. 출력 형식이 도중에 바뀌면 잘못된 WAV를 저장하지 않고 실패로 처리합니다.
- 후보 음성이 말하는 도중 도착하더라도 정지까지 보관하는 워키토키 방식을 계산합니다. 단순히 음소거했다가 해제해서 앞부분이 사라지는 방식이 아닙니다.
- 두 연결 모두 준비된 뒤 측정합니다. 연결 준비 시간은 별도 `setupMs`입니다. 기준 앱의 녹음 종료·파일 변환 시간과 실물 휴대폰의 재생 지연은 포함되지 않습니다.
- 기본 비교에는 이전 대화 문맥을 넣지 않습니다. 현재 Gemini의 문맥 기능과 OpenAI의 연속 대화 문맥 차이는 별도의 실제 대화 시험이 필요합니다.

## 실행

### Google Cloud Shell에서 숨김 입력으로 실행

이 도구는 사용자의 Cloud Shell에서 실행됩니다. Cloud Shell에 입력한 키나 생성된 결과가 Codex 작업 환경에 자동으로 전달되지는 않습니다. 키 대신 결과 파일만 대화에 첨부하세요. 운영 Cloud Run의 환경 변수나 Secret Manager를 바꿀 필요는 없습니다.

**녹음 없이 가장 간단하게 시작하기:** 비교용 저장소 폴더의 터미널에서 아래 명령을 실행하세요. 최신 비교 도구를 받은 뒤 녹음 경로와 번역 방향 질문을 건너뛰고, 한국어→일본어 시험의 키 입력으로 진행합니다. 키를 명령문에 적지 마세요.

```sh
git pull --ff-only origin chore/voice-translation-benchmark && bash scripts/voice-benchmark/cloud-shell.sh --synthetic
```

아래 절차는 본인 녹음이나 일본어→한국어 방향을 선택할 때 사용합니다.

`Synthetic speech connection failed or timed out` 또는 연결 실패가 나오면, 키를 다시 넣고 반복 실행하기 전에 아래 검사부터 실행하세요.

```sh
git pull --ff-only origin chore/voice-translation-benchmark && node scripts/voice-benchmark/diagnose.mjs
```

이 검사는 API 키나 녹음을 보내지 않고, Node와 curl이 OpenAI의 모델 목록 주소에서 HTTP 응답을 받을 수 있는지만 확인합니다. 번역·음성 생성 모델을 호출하지 않습니다. HTTP 401은 키를 보내지 않은 검사에서 예상되는 응답이며 키 오류 판정이 아닙니다. 프록시 설정은 존재 여부만 출력하고, 키·프록시 주소·원본 오류 메시지는 출력하지 않습니다. 출력된 검사 결과를 대화에 붙여넣으면 됩니다. 검사 통과만으로 유료 음성 요청의 성공이 보장되지는 않습니다. 앞선 유료 요청의 과금 여부도 이 검사로 확인할 수 없습니다.

1. [비교용 Cloud Shell 열기](https://shell.cloud.google.com/?cloudshell_git_repo=https://github.com/kanata-git-hub/orihani_translate&cloudshell_git_branch=chore/voice-translation-benchmark&cloudshell_workspace=.&show=terminal)를 누릅니다. 이 링크는 별도 임시 환경을 열 수 있으므로 결과는 세션 종료 전에 다운로드하세요.
2. **녹음이 없어도 진행할 수 있습니다.** 아래 명령을 실행하고 녹음 경로 질문에서 Enter를 누르면 시험용 AI 합성 음성을 만듭니다. 본인 녹음을 사용하려면 30초 이내의 파일을 Cloud Shell의 **더보기(⋮) → 업로드**로 올리고 그 경로를 입력합니다.
3. 번역 방향은 Enter가 한국어→일본어, 2가 일본어→한국어입니다. 키는 마지막 숨김 입력에만 붙여넣고 Enter를 누릅니다.

```sh
bash scripts/voice-benchmark/cloud-shell.sh
```

필요한 npm 의존성은 키 입력 전에 설치합니다. 기존 WAV가 지원 형식이면 그대로 사용하고, 그 외 형식은 ffmpeg로 변환합니다. ffmpeg가 없는 경우 설치 명령을 안내하고 API 호출 전에 종료합니다. 30초를 넘는 녹음은 자동으로 잘라 비교하지 않고 거부합니다. Node 20 이상이 필요하며 이 저장소에서 검증한 실행 환경은 Node 24입니다.

키는 실행 중인 자식 프로세스에만 전달하며 입력을 화면에 표시하거나 키 파일을 만들지 않습니다. 비교는 각 제공자에 1회 요청합니다. 합성 입력을 선택하면 시험 음성을 만드는 OpenAI TTS 요청이 1회 추가되어, OpenAI 2회와 기존 Gemini 서버 1회 요청이 됩니다. 실제 API 사용료가 발생합니다.

합성 음성은 `gpt-4o-mini-tts`로 만들고, 한국어는 `marin`, 일본어는 `cedar` 음성을 사용합니다. 이 모델은 시험 입력을 만드는 용도로만 사용합니다. 예약 취소 금지, 시각·인원수, 새우 섭취 제한, 추가 요금 조건을 포함한 문장을 두 언어로 준비했습니다. 생성한 **동일 PCM**을 Gemini와 OpenAI에 보내며, 합성에 걸린 시간은 번역 속도에 포함하지 않습니다. ffmpeg나 사전 녹음이 필요하지 않습니다.

`report.json`의 `inputSource`에 AI 합성 여부, 모델·음성·원문을 남깁니다. 합성기가 원문을 정확히 읽었는지 `source.wav`도 들어 보세요. 깨끗한 합성 음성과 OpenAI가 만든 입력을 쓰는 점이 비교 결과에 영향을 줄 수 있으므로, 이 결과만으로 실제 대화의 품질이나 모델 교체를 결정하지 않습니다. 초기 연결·속도 검사를 마친 뒤 실제 발화·소음·말 멈춤·한일 혼용을 따로 검사해야 합니다. [OpenAI 음성 합성 공식 문서](https://developers.openai.com/api/docs/guides/text-to-speech)

종료 시 표시되는 결과 폴더에서 `report.json`, `source.wav`, `baseline.wav`, `openai.wav`를 Cloud Shell의 **더보기(⋮) → 다운로드**로 받아 대화에 첨부하세요. 일부 제공자가 실패하면 존재하는 결과와 오류 메시지만 보내세요. 비교 파일에는 녹음과 번역문이 들어 있으므로 공개 GitHub에 올리지 마세요. 첫 1회 결과는 연결 확인이며 품질·속도의 최종 판정은 여러 문장과 반복 측정이 필요합니다.

Google 공식 안내: [파일 업로드·다운로드](https://docs.cloud.google.com/shell/docs/uploading-and-downloading-files), [저장소를 Cloud Shell에서 열기](https://docs.cloud.google.com/shell/docs/open-in-cloud-shell).

### 기존 한국어 원음으로 OpenAI만 재검사

이미 만든 `source.wav`가 있으면 아래의 경로를 실제 파일 경로로 바꿔 실행합니다. 한국어→일본어 전용 단축 실행이며 키만 숨김 입력으로 받습니다. OpenAI 번역 1회만 호출하고 시험 음성 생성과 Gemini 호출은 생략합니다.

```sh
git pull --ff-only origin chore/voice-translation-benchmark && bash scripts/voice-benchmark/cloud-shell.sh --openai-audio /전체/경로/source.wav
```

새 결과 폴더의 `report.json`, `source.wav`, `openai.wav`를 다운로드하세요. 보고서의 원음 해시가 이전 결과와 같은지 확인해야 같은 입력의 재검사라고 볼 수 있습니다. 이 실행의 `inputSource.kind`는 파일을 제공했다는 뜻의 `provided_audio`이며, 원래 합성한 음성인지 여부는 이전 보고서에서 확인합니다.

### 원음 인식 진단

정상적인 번역이 나오지 않으면 같은 비교를 반복하기 전에, 이미 저장한 한국어 `source.wav`로 아래 진단을 1회 실행할 수 있습니다.

```sh
git pull --ff-only origin chore/voice-translation-benchmark && bash scripts/voice-benchmark/cloud-shell.sh --diagnose-input /전체/경로/source.wav
```

이 모드만 `audio.input.transcription.model = gpt-realtime-whisper`를 설정하여 같은 번역 연결에서 별도 원음 받아쓰기 결과를 받습니다. 서버가 받아쓰기 설정을 확인하기 전에는 원음을 전송하지 않습니다. 기존 원음을 그대로 쓰며 Gemini와 입력 합성 TTS를 호출하지 않습니다. **OpenAI 번역 사용료에 별도 받아쓰기 사용료가 추가됩니다.** 기본 비교와 `--openai-audio`에서는 이 옵션을 켜지 않습니다.

터미널에 원음 받아쓰기, 일본어 번역문, 전송 크기·해시와 주요 서버 이벤트 개수가 표시됩니다. 이 부분을 대화에 복사하면 파일을 다시 다운로드하기 전에 입력 인식 여부를 검토할 수 있습니다. 원음·번역문은 공개 저장소에 올리지 마세요. 중간에 오류가 생겨도 이미 받은 받아쓰기와 설정 기록은 보고서의 `diagnosticPartial`에 보존합니다.

받아쓰기 문장이 원음과 일치하면 서버의 별도 인식 모델까지 음성이 도달한 근거가 됩니다. 번역 모델 내부의 인식 내용이 같다고 증명하는 것은 아닙니다. 받아쓰기도 비어 있으면 전송·인식·설정 문제를 계속 구분해야 하며, 미전송으로 자동 판정하지 않습니다. 이 모드의 `purpose`는 `input_diagnostic`이고 추가 모델을 함께 쓰므로 이전 속도 측정과 직접 비교하지 않습니다. 실제 API에서 진단이 성공했는지는 실행 결과로 확인해야 합니다.

[OpenAI 공식 입력 받아쓰기 설정](https://developers.openai.com/api/reference/resources/realtime/translation-client-events), [받아쓰기 모델 및 과금](https://developers.openai.com/api/docs/models/gpt-realtime-whisper).

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

# 녹음 없이 시험용 합성 음성을 만드는 경로입니다. --run 없이 실행하면 안내만 출력합니다.
node scripts/voice-benchmark/run.mjs --synthetic --source ko --target ja --run
```

반대 방향은 `--source ja --target ko`로 실행합니다. 순서 효과를 줄이려면 다음 반복에 `--openai-first`를 사용합니다. 동일 문장을 최소 3회씩 비교하고, 여러 문장의 중앙값과 느린 사례를 함께 확인합니다.
키가 없으면 두 제공자 모두 호출하기 전에 종료합니다. 도구 자체는 실패한 요청을 자동 재시도하지 않습니다. 기존 Gemini 서버의 재시도 정책은 그대로 적용됩니다.

결과는 이 폴더의 Git 제외 대상인 `results/날짜/`에 저장합니다. `source.wav`, 두 제공자의 출력 WAV, 번역문과 시간 정보를 담은 `report.json`은 공개 저장소에 올리지 마세요. 입력을 이 폴더에 보관할 때는 Git 제외 대상인 `inputs/`를 사용하세요.

## 판정

1. **품질**: 같은 원음과 두 출력 음성을 익명 순서로 듣고 의미·부정·숫자·고유명사·조건절·말투·문장 끝 누락을 비교합니다. 일본어와 한국어 양방향 모두 확인합니다. 평균이 비슷해도 중요한 내용을 자주 틀리면 채택하지 않습니다.
2. **속도**: 정지부터 첫 음성 패킷, 첫 재생 예약, 신호가 포함된 샘플의 예상 재생, 전체 수신 완료까지 각각 기록합니다. 첫 패킷 도착만으로 체감 속도가 빨라졌다고 판단하지 않습니다. 초기 채택 기준안은 같은 입력에서 중앙값 30% 이상 단축, 현재 약 5초인 사용 상황에서 3초 이내 재생 시작입니다. 이는 목표이며 실측 결과가 아닙니다.
3. **끊김**: 현재 앱의 150ms 초기 버퍼와 50ms 보충 기준을 적용했을 때 생기는 추가 재생 간격을 계산합니다. `hindsightMinimumStartDelayMs`는 모든 패킷을 받은 뒤 계산한 이론적 최소 대기 시간이며, 실시간으로 미리 알 수 있는 값이 아닙니다. WAV는 받은 음성을 순서대로 이어 붙인 것으로 네트워크 간격은 포함하지 않습니다. 자연스러운 쉼과 모델의 발화 중단은 직접 듣고 판단해야 합니다. 최종 판단에는 실제 휴대폰·Wi-Fi·이동통신에서의 검사가 필요합니다.

`qualityStatus`는 자동 채점 대신 `not_assessed`로 남깁니다. `MOSTLY_DIGITAL_SILENCE`는 샘플의 90% 초과가 정확히 0이라는 경고입니다. `NO_SIGNAL_ABOVE_THRESHOLD`와 `NO_OUTPUT_TRANSCRIPT`도 사람이 검토할 신호이며, 경고가 없다고 품질이 통과한 것은 아닙니다. `stopToFirstSignalPacketMs`는 신호가 들어 있는 패킷의 수신 시간이고, `stopToFirstSignalEstimateMs`는 앞선 무음까지 재생했을 때의 신호 시작 추정값입니다. 둘 다 실제 발화인지, 제대로 번역한 말인지는 별도 확인해야 합니다.

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
- https://developers.openai.com/api/reference/resources/realtime/translation-client-events
- https://developers.openai.com/api/reference/resources/realtime/translation-server-events

```sh
node --test tests/voiceBenchmark.test.mjs
node --test tests/voiceConnectivity.test.mjs
```
