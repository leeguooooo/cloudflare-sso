#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:?usage: $0 <callback_base_url> <code> <state> <state_cookie> <verifier_cookie> <return_cookie> [state_cookie_name] [verifier_cookie_name] [return_cookie_name]}"
CODE="${2:?}"
STATE="${3:?}"
STATE_COOKIE_VAL="${4:-}"
VERIFIER_COOKIE_VAL="${5:-}"
RETURN_COOKIE_VAL="${6:-}"
STATE_COOKIE_NAME="${7:-blog_sso_state}"
VERIFIER_COOKIE_NAME="${8:-blog_sso_verifier}"
RETURN_COOKIE_NAME="${9:-blog_sso_return}"

OUT_DIR="${SSO_REPRO_OUT_DIR:-/tmp/sso-callback-repro-$(date +%s)}"
mkdir -p "$OUT_DIR"

COOKIE_HEADER_FOR_MATCH=""
if [[ -n "$STATE_COOKIE_VAL" || -n "$VERIFIER_COOKIE_VAL" || -n "$RETURN_COOKIE_VAL" ]]; then
  COOKIE_PARTS=()
  [[ -n "$STATE_COOKIE_VAL" ]] && COOKIE_PARTS+=("${STATE_COOKIE_NAME}=${STATE_COOKIE_VAL}")
  [[ -n "$VERIFIER_COOKIE_VAL" ]] && COOKIE_PARTS+=("${VERIFIER_COOKIE_NAME}=${VERIFIER_COOKIE_VAL}")
  [[ -n "$RETURN_COOKIE_VAL" ]] && COOKIE_PARTS+=("${RETURN_COOKIE_NAME}=${RETURN_COOKIE_VAL}")
  COOKIE_HEADER_FOR_MATCH="$(IFS='; '; echo "${COOKIE_PARTS[*]}")"
fi

run_case() {
  local label="$1"
  local state_value="$2"
  local use_cookie="$3" # yes or no

  local hdr="${OUT_DIR}/${label}.headers"
  local body="${OUT_DIR}/${label}.body"
  local http_code=""
  local x_request_id=""
  local content_type=""

  local cookie_arg=()
  if [[ "$use_cookie" == "yes" && -n "$COOKIE_HEADER_FOR_MATCH" ]]; then
    cookie_arg=(-H "Cookie: ${COOKIE_HEADER_FOR_MATCH}")
  fi

  http_code=$(
    curl -sS -L \
      -H "Accept: application/json" \
      -H "User-Agent: sso-callback-repro/1.0" \
      "${cookie_arg[@]}" \
      --get \
      --data-urlencode "code=${CODE}" \
      --data-urlencode "state=${state_value}" \
      "$BASE_URL" \
      -D "$hdr" \
      -o "$body" \
      -w "%{http_code}"
  )

  x_request_id=$(awk 'BEGIN{IGNORECASE=1} /^x-request-id:[[:space:]]*/{sub(/\r/, "", $0); $1=""; sub(/^ /,"",$0); print; exit}' "$hdr" || true)
  content_type=$(awk 'BEGIN{IGNORECASE=1} /^content-type:[[:space:]]*/{sub(/\r/, "", $0); $1=""; sub(/^ /,"",$0); print; exit}' "$hdr" || true)

  echo "===== ${label} ====="
  echo "HTTP: $http_code"
  echo "x-request-id: ${x_request_id:-<none>}"
  echo "content-type: ${content_type:-<none>}"
  echo "---- body ----"
  cat "$body"
  echo
}

echo "Target: ${BASE_URL}"
echo "Code  : ${CODE}"
echo "State : ${STATE}"
echo "Match cookies: ${COOKIE_HEADER_FOR_MATCH:-<none>}"
echo

# 1) clean cookie
run_case "clean_cookie" "$STATE" "no"

# 2) state mismatch + cookie
run_case "state_mismatch_with_cookie" "${STATE}-MISMATCH-$RANDOM" "yes"

# 3) provider exchange
run_case "provider_exchange" "$STATE" "yes"

echo "Artifacts: $OUT_DIR"
