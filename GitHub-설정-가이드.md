# 시장날씨 — 아이폰 앱 + 매일 자동 알림 설정 (처음 한 번)

준비물: GitHub 계정(무료), 아이폰(iOS 16.4 이상), 컴퓨터의 sijangnalssi 폴더

## 1. GitHub 저장소 만들기
1. github.com 가입 → 오른쪽 위 `+` → **New repository**
2. Repository name: `sijangnalssi` · **Public** 선택(무료 Pages는 공개 저장소만 가능) → Create repository
3. 공개 저장소에는 **키·보유 자산이 절대 들어가면 안 됩니다.** 그래서 업로드는 반드시 `sijangnalssi-github-업로드용.zip`을 푼 폴더 안의 파일로만 합니다.

## 2. 파일 올리기
1. 저장소 화면의 **uploading an existing file** 클릭
2. `sijangnalssi-github-업로드용` 폴더를 열고 **안의 파일·폴더 전부**를 끌어다 놓기 (`.github` 폴더 포함)
3. 아래 **Commit changes**

## 3. 알림 키 만들기 (컴퓨터)
connect 폴더 주소창에 cmd → `node push-setup.mjs 내이메일@example.com`
화면에 나오는 값과 connect/.env 의 VAPID_PRIVATE_KEY 값을 4번에 씁니다.

## 4. 비밀값 넣기 (GitHub 저장소 → Settings → Secrets and variables → Actions → New repository secret)
| 이름 | 값 |
|---|---|
| VAPID_PUBLIC_KEY | push-setup 화면의 공개키 |
| VAPID_PRIVATE_KEY | connect/.env 의 VAPID_PRIVATE_KEY 값 |
| VAPID_EMAIL | 내 이메일 |
| DART_API_KEY | OpenDART 인증키 (한국 종목 재무) |
| SEC_CONTACT | 내 이메일 (미국 종목 재무, SEC 규칙) |
| PUSH_SUBSCRIPTIONS | 7번에서 아이폰 앱이 보여 주는 연결 코드 |

빗썸·토스증권 키는 **넣지 않습니다**(IP가 묶여 있고, 보유 자산은 컴퓨터에서만 다룸).

## 5. 앱 배포 켜기
Settings → **Pages** → Build and deployment → Source: **GitHub Actions**

## 6. 첫 실행
**Actions** 탭 → "매일 자동 분석·알림" → **Run workflow**. 5~10분 뒤 초록색 체크가 뜨면 Settings → Pages 에 앱 주소(`https://아이디.github.io/sijangnalssi/`)가 나옵니다.

## 7. 아이폰에 설치하고 알림 켜기
1. 아이폰 **사파리**로 앱 주소 열기 → 아래 공유 버튼 → **홈 화면에 추가**
2. 홈 화면의 시장날씨 아이콘으로 열기 → 오른쪽 위 종 모양 → **알림 켜기** → 허용
3. **연결 코드 복사** → 4번의 PUSH_SUBSCRIPTIONS 에 붙여 넣기
4. **테스트 알림**으로 확인. 다음 자동 실행부터 매수 후보가 나오면 알림이 옵니다.

자동 실행: 평일 한국 16:10, 화~토 07:30. 같은 종목은 7일 안에 다시 알리지 않습니다.
