#!/usr/bin/env bash
# Run as a child shell so the key never enters the interactive shell's history or environment.
set +x
if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  printf '%s\n' 'source 대신 bash scripts/voice-benchmark/cloud-shell.sh 로 실행하세요.' >&2
  return 1
fi
set -euo pipefail
if ! { (( $# == 0 )) || { (( $# == 1 )) && [[ "$1" == '--synthetic' ]]; } || { (( $# == 2 )) && [[ "$1" == '--openai-audio' || "$1" == '--diagnose-input' || "$1" == '--live-audio' ]]; }; }; then
  printf '%s\n' '사용법: bash scripts/voice-benchmark/cloud-shell.sh [--synthetic | --openai-audio 기존원음.wav | --diagnose-input 기존원음.wav | --live-audio 기존원음.wav]' >&2
  exit 1
fi
umask 077
unset OPENAI_API_KEY
benchmark_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
benchmark_root=$(cd -- "$benchmark_dir/../.." && pwd)
benchmark_runner="$benchmark_dir/run.mjs"
if [[ "${1:-}" == '--live-audio' ]]; then benchmark_runner="$benchmark_dir/live.mjs"; fi
benchmark_key=''
benchmark_wav=''
cleanup() {
  unset benchmark_key
  if [[ -n "$benchmark_wav" ]]; then rm -f -- "$benchmark_wav"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
exec 3</dev/tty

node -e 'if (Number(process.versions.node.split(".")[0]) < 20) { console.error("Node 20 이상이 필요합니다. 검증 환경은 Node 24입니다."); process.exit(1); }'
cd -- "$benchmark_root"
if ! node --input-type=module -e "import('ws')" >/dev/null 2>&1; then
  printf '%s\n' '비교 도구의 의존성을 설치합니다. 아직 API를 호출하지 않습니다.'
  npm ci --no-audit --no-fund
fi

if [[ "${1:-}" == '--openai-audio' || "${1:-}" == '--diagnose-input' || "${1:-}" == '--live-audio' ]]; then
  benchmark_input=$2
  if [[ -z "$benchmark_input" ]]; then
    printf '%s\n' '재검사할 기존 한국어 원음의 경로를 입력하세요.' >&2
    exit 1
  fi
  benchmark_direction=1
  printf '%s\n' '기존 한국어 원음으로 OpenAI 일본어 번역을 1회 검사합니다. 시험 음성은 새로 만들지 않습니다.'
elif [[ "${1:-}" == '--synthetic' ]]; then
  benchmark_input=''
  benchmark_direction=1
  printf '%s\n' '시험용 한국어 음성을 생성해 일본어 번역을 비교합니다. 녹음 파일은 필요하지 않습니다.'
else
  printf '%s\n' '녹음이 없으면 Enter를 누르세요. 시험용 합성 음성을 만들어 비교합니다.'
  read -r -p '녹음 파일 경로 (Enter: 시험용 음성 자동 생성): ' benchmark_input <&3
  # Treat an accidental blank space or CR from pasted input as an empty answer.
  if [[ "$benchmark_input" =~ ^[[:space:]]*$ ]]; then benchmark_input=''; fi
  read -r -p '번역 방향 (1: 한국어→일본어, 2: 일본어→한국어, Enter: 1): ' benchmark_direction <&3
fi
case "$benchmark_direction" in
  ''|1) benchmark_source=ko; benchmark_target=ja ;;
  2) benchmark_source=ja; benchmark_target=ko ;;
  *) printf '%s\n' '1 또는 2를 입력하세요.' >&2; exit 1 ;;
esac

benchmark_args=(--source "$benchmark_source" --target "$benchmark_target")
if [[ "${1:-}" == '--openai-audio' || "${1:-}" == '--diagnose-input' ]]; then benchmark_args+=(--provider openai); fi
if [[ "${1:-}" == '--diagnose-input' ]]; then benchmark_args+=(--diagnose-input); fi
if [[ -z "$benchmark_input" ]]; then
  benchmark_args+=(--synthetic)
  printf '%s\n' 'AI 합성 음성을 사용한 초기 검사입니다. 실제 발화·소음에서의 품질은 별도 확인이 필요합니다.'
  printf '%s\n' '시험 음성 생성으로 OpenAI TTS 요청이 1회 추가됩니다.'
else
  if [[ "$benchmark_input" == '~/'* ]]; then benchmark_input="$HOME/${benchmark_input:2}"; fi
  if [[ ! -f "$benchmark_input" ]]; then
    printf '%s\n' '녹음 파일을 찾지 못했습니다. 업로드 후 표시된 전체 경로를 입력하세요.' >&2
    exit 1
  fi
  benchmark_input=$(realpath -- "$benchmark_input")
  # Check a ready WAV first; only require ffmpeg if conversion is necessary.
  if ! node "$benchmark_runner" --audio "$benchmark_input" "${benchmark_args[@]}" >/dev/null 2>&1; then
    if ! command -v ffmpeg >/dev/null; then
      printf '%s\n' '이 녹음은 변환이 필요합니다. sudo apt-get update && sudo apt-get install -y ffmpeg 실행 후 다시 시작하세요.' >&2
      exit 1
    fi
    mkdir -p -- "$benchmark_dir/inputs"
    benchmark_wav=$(mktemp "$benchmark_dir/inputs/converted-XXXXXXXX.wav")
    ffmpeg -nostdin -hide_banner -loglevel error -y -i "$benchmark_input" -vn -ar 24000 -ac 1 -c:a pcm_s16le "$benchmark_wav"
    benchmark_input=$benchmark_wav
  fi
  benchmark_args+=(--audio "$benchmark_input")
fi
node "$benchmark_runner" "${benchmark_args[@]}"

if [[ "${1:-}" == '--live-audio' ]]; then
  printf '%s\n' '키 입력 후 GPT-Live 1만 1회 시험합니다. 기존 원음을 사용하며 Gemini·시험 음성 생성·별도 받아쓰기는 호출하지 않습니다.'
  printf '%s\n' '원음 재생 길이 + 30초 동안 음성을 수신한 뒤 연결을 종료합니다. 연결 시간에 따른 API 사용료가 발생합니다.'
elif [[ "${1:-}" == '--diagnose-input' ]]; then
  printf '%s\n' '키 입력 후 번역 연결 1회에 원음 받아쓰기를 추가합니다. 번역과 별도 받아쓰기 사용료가 발생합니다.'
  printf '%s\n' '이번 실행은 입력 인식 진단이며 속도 비교용이 아닙니다. 결과를 터미널에 표시합니다.'
elif [[ "${1:-}" == '--openai-audio' ]]; then
  printf '%s\n' '키 입력 후 OpenAI 번역만 1회 요청합니다. API 사용료가 발생합니다.'
else
  printf '%s\n' '키 입력 후 동일 녹음으로 Gemini와 OpenAI에 각각 1회 요청합니다. API 사용료가 발생합니다.'
fi
read -r -s -p 'OpenAI API 키 (화면에 표시되지 않음): ' benchmark_key <&3
printf '\n'
if [[ -z "$benchmark_key" || "$benchmark_key" == *[[:space:]]* ]]; then
  printf '%s\n' '키가 비어 있거나 공백이 들어 있습니다. API를 호출하지 않았습니다.' >&2
  exit 1
fi
# Preserve the result instructions even when the API run exits unsuccessfully.
benchmark_status=0
OPENAI_API_KEY="$benchmark_key" node "$benchmark_runner" "${benchmark_args[@]}" --run || benchmark_status=$?
unset benchmark_key
if [[ "${1:-}" == '--live-audio' ]]; then
  printf '%s\n' '원음 받아쓰기, 번역문, 시험 기록이 나온 부분을 복사해 대화에 보내 주세요.'
  printf '%s\n' '들을 음성은 결과 폴더의 live.wav입니다. 앞부분 무음도 보존한 원본은 live-raw.wav입니다.'
elif [[ "${1:-}" == '--diagnose-input' ]]; then
  printf '%s\n' '원음 받아쓰기, 일본어 번역문, 입력 진단 기록이 나온 부분을 복사해 대화에 보내 주세요.'
elif [[ "${1:-}" == '--openai-audio' ]]; then
  printf '%s\n' '표시된 결과 폴더의 report.json, source.wav, openai.wav를 다운로드해 대화에 첨부해 주세요.'
else
  printf '%s\n' '표시된 결과 폴더의 report.json, source.wav, baseline.wav, openai.wav를 다운로드해 대화에 첨부해 주세요.'
fi
printf '%s\n' '키는 파일에 저장하지 않았습니다. 이 입력 단계만으로 Codex에 키가 연결되는 것은 아닙니다.'
exit "$benchmark_status"
