# Vercel 배포 가이드

## 1. 사전 준비

### 필요한 것
- [Vercel 계정](https://vercel.com/signup) (GitHub 계정으로 가입 권장)
- PostgreSQL 데이터베이스 (외부에서 접속 가능해야 함)
  - Vercel Postgres
  - Supabase
  - Railway
  - Neon
  - 또는 다른 클라우드 PostgreSQL 서비스

### Git 저장소 설정
프로젝트를 Git 저장소에 푸시해야 합니다:

```bash
# Git 초기화 (이미 되어있다면 생략)
git init

# 변경사항 커밋
git add .
git commit -m "Ready for Vercel deployment"

# GitHub 저장소에 푸시
git remote add origin <your-github-repo-url>
git push -u origin main
```

## 2. Vercel 프로젝트 생성

1. [Vercel 대시보드](https://vercel.com/dashboard)에 로그인
2. "Add New..." → "Project" 클릭
3. GitHub 저장소 연결 및 선택
4. 프로젝트 설정:
   - **Framework Preset**: Other
   - **Root Directory**: ./
   - **Build Command**: (비워두기)
   - **Output Directory**: (비워두기)

## 3. 환경 변수 설정

Vercel 프로젝트 설정 페이지에서 다음 환경 변수들을 추가:

### 필수 환경 변수

```
PG_HOST=your-postgres-host.com
PG_DB=your-database-name
PG_USER=your-username
PG_PASSWORD=your-password
PG_PORT=5432
```

### 설정 방법
1. Vercel 프로젝트 → Settings → Environment Variables
2. 각 변수 이름과 값을 입력
3. Environment 선택: Production, Preview, Development 모두 선택 권장

## 4. 배포

### 자동 배포
- main 브랜치에 푸시하면 자동으로 배포됩니다:
```bash
git push origin main
```

### 수동 배포
Vercel 대시보드에서 "Deployments" → "Deploy" 클릭

## 5. 배포 후 확인

배포가 완료되면 Vercel이 제공하는 URL로 접속:
- `https://your-project-name.vercel.app`

### 확인 사항
- ✅ 홈페이지 로딩
- ✅ 검색 필터 작동
- ✅ 건물 검색 자동완성
- ✅ 실거래가 조회
- ✅ 모달 팝업

## 6. 데이터베이스 준비

### Vercel Postgres 사용 (권장)

1. Vercel 프로젝트 → Storage → Create Database
2. Postgres 선택
3. 자동으로 환경 변수가 설정됨

### 외부 PostgreSQL 사용

데이터베이스에 다음 테이블들이 필요합니다:
- `apt_rent_transactions` (아파트 전월세 거래)
- `villa_rent_transactions` (연립다세대 전월세 거래)
- `officetel_rent_transactions` (오피스텔 전월세 거래)
- `dagagu_rent_transactions` (단독다가구 전월세 거래)
- `apartment_price` (공동주택 가격 정보)
- `officetel_standard_price` (오피스텔 기준시가)
- `unit_info` (호실 정보)

## 7. 문제 해결

### 배포가 실패하는 경우

1. **빌드 로그 확인**
   - Vercel 대시보드 → Deployments → 실패한 배포 클릭 → Build Logs 확인

2. **일반적인 문제**
   - 환경 변수 누락 → Environment Variables 재확인
   - 데이터베이스 연결 실패 → 데이터베이스 접근 권한 확인
   - Python 버전 문제 → requirements.txt 확인

### 데이터베이스 연결 오류

```
psycopg.OperationalError: connection failed
```

해결 방법:
- 데이터베이스 호스트가 외부에서 접속 가능한지 확인
- 방화벽 설정 확인
- SSL 연결 설정 (필요시 app.py에서 `sslmode='require'` 추가)

### 서버리스 함수 타임아웃

```
FUNCTION_INVOCATION_TIMEOUT
```

해결 방법:
- Vercel Pro 플랜으로 업그레이드 (무료: 10초, Pro: 60초)
- 또는 쿼리 최적화

## 8. 성능 최적화

### 데이터베이스 인덱스

다음 인덱스들이 생성되어 있는지 확인:

```sql
-- 각 테이블에 대해
CREATE INDEX idx_apt_sggcd_umdnm ON apt_rent_transactions(sggcd, umdnm);
CREATE INDEX idx_apt_umdnm_jibun ON apt_rent_transactions(umdnm, jibun);
-- villa, officetel, dagagu도 동일하게
```

### 연결 풀링

서버리스 환경에서는 연결 풀이 중요합니다. 현재 코드는 요청마다 새 연결을 생성하므로, 트래픽이 많은 경우 PgBouncer 같은 연결 풀러 사용 권장.

## 9. 커스텀 도메인 (선택사항)

1. Vercel 프로젝트 → Settings → Domains
2. 도메인 추가
3. DNS 설정 (Vercel이 안내)

## 10. 모니터링

- Vercel Analytics: 프로젝트 → Analytics
- 에러 로그: Vercel 대시보드 → 프로젝트 → Deployments → Logs

---

## 참고 링크

- [Vercel 문서](https://vercel.com/docs)
- [Vercel Python 런타임](https://vercel.com/docs/runtimes#official-runtimes/python)
- [Vercel Postgres](https://vercel.com/docs/storage/vercel-postgres)
