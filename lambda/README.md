# VWorld API Proxy - AWS Lambda 배포 가이드

이 Lambda 함수는 Seoul 리전(ap-northeast-2)에서 실행되어 VWorld API를 호출하는 프록시입니다.

## 배포 방법 1: AWS 콘솔 (가장 간단)

### 1. AWS Lambda 함수 생성

1. AWS 콘솔에서 Lambda 서비스로 이동
2. **리전을 "Asia Pacific (Seoul) ap-northeast-2"로 선택** (매우 중요!)
3. "함수 생성" 클릭
4. 다음 정보 입력:
   - 함수 이름: `vworld-api-proxy`
   - 런타임: `Python 3.11`
   - 아키텍처: `x86_64`
5. "함수 생성" 클릭

### 2. 함수 코드 업로드

1. 생성된 함수의 "코드" 탭으로 이동
2. `lambda_function.py` 파일의 내용을 모두 삭제
3. `vworld_proxy.py` 파일의 내용을 복사하여 붙여넣기
4. "Deploy" 버튼 클릭

### 3. Lambda 설정 조정

1. "구성" 탭 > "일반 구성" 클릭
2. "편집" 클릭하여 다음 설정:
   - 제한 시간: `30초`
   - 메모리: `128 MB` (기본값)
3. "저장" 클릭

### 4. API Gateway 생성

1. Lambda 함수 페이지 상단의 "함수 개요"에서 "트리거 추가" 클릭
2. 트리거 선택: `API Gateway`
3. API 선택:
   - API 유형: `HTTP API` (REST API가 아님!)
   - 보안: `열기` (CORS 때문에)
4. "추가" 클릭
5. 생성된 API Gateway의 **엔드포인트 URL 복사** (예: `https://xxxxx.execute-api.ap-northeast-2.amazonaws.com/default/vworld-api-proxy`)

### 5. CORS 설정 (중요!)

1. API Gateway 콘솔로 이동 (Lambda 트리거에서 API 이름 클릭)
2. 왼쪽 메뉴에서 "CORS" 클릭
3. 다음 설정:
   - Access-Control-Allow-Origin: `*`
   - Access-Control-Allow-Headers: `*`
   - Access-Control-Allow-Methods: `GET, POST, OPTIONS`
4. "저장" 클릭

### 6. 엔드포인트 URL을 환경변수에 추가

복사한 API Gateway 엔드포인트 URL을 Vercel 환경변수에 추가:
- 변수 이름: `VWORLD_PROXY_URL`
- 값: `https://xxxxx.execute-api.ap-northeast-2.amazonaws.com/default/vworld-api-proxy`

---

## 배포 방법 2: AWS CLI (자동화)

### 사전 요구사항
```bash
# AWS CLI 설치 확인
aws --version

# AWS 자격 증명 설정
aws configure
```

### 배포 스크립트 실행
```bash
cd lambda
./deploy.sh
```

---

## 테스트

배포 후 다음 URL로 테스트:
```
https://your-api-gateway-url/default/vworld-api-proxy?pnu=1111011000100010001&key=YOUR_API_KEY&domain=https://rent-transactions.ziptoss.com
```

정상 응답: XML 형식의 VWorld API 데이터

---

## 비용

- Lambda: 월 100만 요청까지 무료
- API Gateway: 월 100만 API 호출까지 무료
- 예상 비용: **무료** (무료 티어 범위 내)
