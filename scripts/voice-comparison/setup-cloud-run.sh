#!/usr/bin/env bash
# Run in the owner's Google Cloud Shell. Never pass the key as an argument.
set +x
set -euo pipefail
umask 077
voice_project='gen-lang-client-0165298283'
voice_service='orihani-translate'
voice_region='asia-northeast1'
voice_secret='orihani-openai-voice-test'
voice_private_dir=$(mktemp -d)
trap 'unset voice_api_key; rm -rf "$voice_private_dir"' EXIT
trap 'exit 130' INT TERM

command -v gcloud >/dev/null || { echo 'Google Cloud Shell 터미널에서 실행해 주세요.'; exit 1; }
echo '기존 번역 앱에 시험용 OpenAI 키를 연결합니다. 키는 Google Secret Manager에 보관합니다.'
voice_project_number=$(gcloud projects describe "$voice_project" --format='value(projectNumber)')
[[ "$voice_project_number" == '610824131458' ]] || { echo '대상 Google 프로젝트가 일치하지 않습니다.'; exit 1; }
gcloud run services describe "$voice_service" --project="$voice_project" --region="$voice_region" \
  --format='json(status.traffic,status.latestReadyRevisionName,status.latestCreatedRevisionName,spec.template.spec.serviceAccountName)' > "$voice_private_dir/service.json"
voice_service_account=$(python3 - "$voice_private_dir/service.json" <<'PY'
import json, sys
s = json.load(open(sys.argv[1]))
t = [x for x in s['status']['traffic'] if x.get('percent', 0)]
if len(t) != 1 or t[0].get('percent') != 100 or not t[0].get('latestRevision'):
    sys.exit('현재 트래픽이 최신 버전 100% 설정이 아닙니다. 배포 상태를 확인한 뒤 진행해야 합니다.')
if s['status'].get('latestCreatedRevisionName') != s['status'].get('latestReadyRevisionName'):
    sys.exit('진행 중이거나 실패한 배포가 있습니다. 먼저 배포 상태를 확인해 주세요.')
account = s.get('spec', {}).get('template', {}).get('spec', {}).get('serviceAccountName')
if not account:
    sys.exit('실행 서비스 계정을 확인하지 못했습니다.')
print(account)
PY
)
voice_enabled=$(gcloud services list --enabled --project="$voice_project" --filter='config.name=secretmanager.googleapis.com' --format='value(config.name)')
if [[ -z "$voice_enabled" ]]; then
  gcloud services enable secretmanager.googleapis.com --project="$voice_project" --quiet
fi
voice_existing=$(gcloud secrets list --project="$voice_project" --filter="name:$voice_secret" --format='value(name)')
if [[ -z "$voice_existing" ]]; then
  gcloud secrets create "$voice_secret" --project="$voice_project" --replication-policy=automatic --quiet
fi
gcloud secrets add-iam-policy-binding "$voice_secret" --project="$voice_project" \
  --member="serviceAccount:$voice_service_account" --role='roles/secretmanager.secretAccessor' --condition=None --quiet >/dev/null

IFS= read -r -s -p 'OpenAI API 키 (화면에 표시되지 않음): ' voice_api_key </dev/tty
printf '\n'
if [[ "$voice_api_key" != sk-* || "$voice_api_key" == *[[:space:]]* ]]; then
  echo '키 형식을 확인해 주세요. 키를 채팅에 보내실 필요는 없습니다.'
  exit 1
fi
voice_version_path=$(printf '%s' "$voice_api_key" | gcloud secrets versions add "$voice_secret" \
  --project="$voice_project" --data-file=- --format='value(name)' --quiet)
unset voice_api_key
voice_version=${voice_version_path##*/}
[[ "$voice_version" =~ ^[0-9]+$ ]] || { echo '비밀키 버전 등록을 확인하지 못했습니다.'; exit 1; }
gcloud run services update "$voice_service" --project="$voice_project" --region="$voice_region" \
  --update-secrets="OPENAI_API_KEY=$voice_secret:$voice_version" --quiet
gcloud run services describe "$voice_service" --project="$voice_project" --region="$voice_region" \
  --format='json(status.conditions,status.latestReadyRevisionName,status.latestCreatedRevisionName,status.traffic)' > "$voice_private_dir/ready.json"
python3 - "$voice_private_dir/ready.json" <<'PY'
import json, sys
s = json.load(open(sys.argv[1]))['status']
if not any(x.get('type') == 'Ready' and x.get('status') == 'True' for x in s.get('conditions', [])):
    sys.exit('키 등록은 완료했지만 앱 배포 준비 상태를 확인하지 못했습니다.')
if s.get('latestCreatedRevisionName') != s.get('latestReadyRevisionName'):
    sys.exit('새 버전이 아직 준비되지 않았습니다.')
if not any(x.get('percent') == 100 and x.get('revisionName') == s['latestReadyRevisionName'] for x in s.get('traffic', [])):
    sys.exit('새 버전으로 트래픽이 전환되었는지 확인해야 합니다.')
print('키 연결 및 Cloud Run 배포 확인 완료: ' + s['latestReadyRevisionName'])
PY
echo '휴대폰에서 기존 계정으로 로그인한 뒤 아래 주소를 여세요.'
echo 'https://orihani-translate-610824131458.asia-northeast1.run.app/app/voice-compare'
echo '키는 채팅이나 공개 저장소에 저장하지 않았습니다. 아직 번역 시험 API는 호출하지 않았습니다.'
