# 전월세 실거래가 조회 웹사이트

PostgreSQL 데이터베이스에 저장된 아파트, 연립다세대, 단독다가구, 오피스텔 전월세 실거래가 데이터를 조회할 수 있는 웹 애플리케이션입니다.

## 주요 기능

- **4가지 주택 유형 조회**: 아파트, 연립다세대, 단독다가구, 오피스텔 데이터 선택적 조회
- **다중 필터 검색**: 계약만기시기, 지역(시도/시군구/읍면동), 면적, 보증금, 월세, 건축년도 등 다양한 조건으로 검색
- **오피스텔 기준시가 검증**: 보증금이 기준시가 126%를 초과하는지 색상으로 표시 (초록/빨강)
- **건물별 상세 조회**: 건물명 클릭 시 해당 건물의 모든 실거래 내역을 모달로 확인
- **무한 스크롤**: 스크롤 시 자동으로 추가 데이터 로드 (페이지당 20건)
- **실시간 데이터 조회**: PostgreSQL 데이터베이스와 직접 연동
- **반응형 디자인**: 모바일, 태블릿, 데스크톱 모든 환경에서 사용 가능
- **성능 최적화**: DOM 캐싱, 이벤트 디바운싱, DocumentFragment 활용

## 프로젝트 구조

```
프로젝트 루트/
├── app.py                  # Flask 백엔드 서버
├── requirements.txt        # Python 패키지 의존성
├── .env                   # 환경 변수 (git 제외)
├── README.md              # 프로젝트 문서
├── files/
│   └── lawd_code.csv      # 법정동 코드 데이터
├── templates/
│   └── index.html         # 메인 페이지
└── static/
    ├── css/
    │   ├── style.css      # 메인 스타일시트
    │   └── table-fix.css  # 테이블 레이아웃 고정
    └── js/
        └── main.js        # JavaScript 로직 (검색, 모달, 무한스크롤)
```

## 설치 및 실행

### 1. 환경 설정

```bash
# 필요한 패키지 설치
pip install -r requirements.txt

# .env 파일 생성 및 설정
cp .env.example .env
# .env 파일을 열어 실제 데이터베이스 정보 입력
```

### 2. .env 파일 설정

```
PG_HOST=your_postgresql_host
PG_DB=your_database_name
PG_USER=your_username
PG_PASSWORD=your_password
PG_PORT=5432
```

### 3. 서버 실행

```bash
python app.py
```

서버가 실행되면 브라우저에서 `http://localhost:5000` 접속

## 데이터베이스 테이블 스키마

**⚠️ 중요**: 각 테이블마다 컬럼 구조가 다릅니다. 쿼리 작성 시 반드시 아래 인덱스를 확인하세요!

### 1. apt_rent_transactions (아파트 전월세)

**데이터 건수**: 약 889만 건
**계약기간 형식**: `YY.MM~YY.MM` (예: `25.07~26.07`)

#### 컬럼 구조 (인덱스 기준)
```
0: unique_key (고유키)
1: sggcd (시군구코드) ← WHERE 절에 사용
2: umdnm (읍면동명) ← WHERE 절에 사용
3: jibun (지번)
4: aptnm (아파트명) ← 건물명
5: excluusear (전용면적) ← 면적
6: floor (층)
7: buildyear (건축년도)
8: dealyear (계약년) ← 계약년월 생성에 사용
9: dealmonth (계약월) ← 계약년월 생성에 사용
10: dealday (계약일)
11: deposit (보증금)
12: monthlyrent (월세)
13: contractterm (계약기간) ← YY.MM~YY.MM 형식
14: contracttype (계약구분)
15: userrright (갱신요구권사용)
16: predeposit (종전계약보증금)
17: premonthlyrent (종전계약월세)
```

#### 모달 쿼리 ORDER BY
```sql
ORDER BY CONCAT(
    LPAD(COALESCE(NULLIF("{col_names[8]}", ''), ''), 4, '0'),
    LPAD(COALESCE(NULLIF("{col_names[9]}", ''), ''), 2, '0')
) DESC, CAST(NULLIF("{col_names[10]}", '') AS INTEGER) DESC NULLS LAST
```

### 2. villa_rent_transactions (연립다세대 전월세)

**데이터 건수**: 약 283만 건
**계약기간 형식**: `YY.MM~YY.MM` (예: `25.07~26.07`)

#### 컬럼 구조 (인덱스 기준)
```
0: unique_key (고유키)
1: sggcd (시군구코드) ← WHERE 절에 사용
2: umdnm (읍면동명) ← WHERE 절에 사용
3: jibun (지번)
4: mhousename (연립다세대명) ← 건물명
5: excluusear (전용면적) ← 면적
6: dealyear (계약년) ← 계약년월 생성에 사용
7: dealmonth (계약월) ← 계약년월 생성에 사용
8: dealday (계약일)
9: deposit (보증금)
10: monthlyrent (월세)
11: floor (층)
12: buildyear (건축년도)
13: created_at (생성일시)
14: contracttype (계약구분)
15: contractterm (계약기간) ← YY.MM~YY.MM 형식
16: predeposit (종전계약보증금)
17: premonthlyrent (종전계약월세)
18: userrright (갱신요구권사용)
```

#### 모달 쿼리 ORDER BY
```sql
ORDER BY CONCAT(
    LPAD(COALESCE(NULLIF("{col_names[6]}", ''), ''), 4, '0'),
    LPAD(COALESCE(NULLIF("{col_names[7]}", ''), ''), 2, '0')
) DESC, CAST(NULLIF("{col_names[8]}", '') AS INTEGER) DESC NULLS LAST
```

### 3. dagagu_rent_transactions (단독다가구 전월세)

**데이터 건수**: 약 148만 건
**계약기간 형식**: `YYYYMM~YYYYMM` (예: `202508~202608`)
**특징**: 컬럼명 일부가 한글로 되어 있음

#### 컬럼 구조 (인덱스 기준)
```
0: id
1: sggcd (시군구코드) ← WHERE 절에 사용
2: bjdcd (법정동코드)
3: umdnm (읍면동명) ← WHERE 절에 사용
4: jibun (지번)
5: bonbun (본번)
6: bubun (부번)
7: 대지권면적
8: 전용면적 ← 면적
9: 계약년월일
10: 계약년월 ← YYYYMM 형식
11: 계약일
12: 보증금
13: 월세
14: 건축년도 ← 소수점 제거 필요 (CASE 문 사용)
15: 건물명 (도로명)
16: 계약기간 ← YYYYMM~YYYYMM 형식
17: 계약구분
18: 갱신요구권사용
19: 종전계약보증금
20: 종전계약월세
21: 층정보 ← 주택유형 저장되어 있어 "-"로 표시
22: created_at (생성일시)
```

#### 건축년도 특수 처리 (⚠️ 필수)
```sql
CASE
    WHEN "{col_names[14]}" IS NULL OR "{col_names[14]}" = '' THEN NULL
    WHEN CAST("{col_names[14]}" AS TEXT) ~ '^[0-9]+\.?[0-9]*$' THEN
        CASE
            WHEN CAST("{col_names[14]}" AS FLOAT) BETWEEN 1800 AND 2200
            THEN CAST(CAST("{col_names[14]}" AS FLOAT) AS INTEGER)
            ELSE NULL
        END
    ELSE NULL
END as 건축년도
```

#### 모달 쿼리 ORDER BY
```sql
ORDER BY "{col_names[10]}" DESC,
         CAST(NULLIF("{col_names[11]}", '') AS INTEGER) DESC NULLS LAST
```

### 4. officetel_rent_transactions (오피스텔 전월세)

**데이터 건수**: 약 182만 건
**계약기간 형식**: `YY.MM~YY.MM` (예: `25.07~26.07`)

#### 컬럼 구조 (인덱스 기준)
```
0: unique_key (고유키)
1: sggcd (시군구코드) ← WHERE 절에 사용
2: sggnm (시군구명)
3: umdnm (읍면동명) ← WHERE 절에 사용
4: jibun (지번)
5: offinm (오피스텔명) ← 건물명
6: excluusear (전용면적) ← 면적
7: floor (층)
8: buildyear (건축년도)
9: dealyear (계약년) ← 계약년월 생성에 사용
10: dealmonth (계약월) ← 계약년월 생성에 사용
11: dealday (계약일)
12: deposit (보증금)
13: monthlyrent (월세)
14: contracttype (계약구분)
15: contractterm (계약기간) ← YY.MM~YY.MM 형식
16: predeposit (종전계약보증금)
17: premonthlyrent (종전계약월세)
18: userrright (갱신요구권사용)
```

#### 모달 쿼리 ORDER BY
```sql
ORDER BY CONCAT(
    LPAD(COALESCE(NULLIF("{col_names[9]}", ''), ''), 4, '0'),
    LPAD(COALESCE(NULLIF("{col_names[10]}", ''), ''), 2, '0')
) DESC, CAST(NULLIF("{col_names[11]}", '') AS INTEGER) DESC NULLS LAST
```

### 5. officetel_standard_price (오피스텔 기준시가)

**데이터 용도**: 오피스텔 전월세 보증금의 기준시가 126% 초과 여부 판단

#### 컬럼 구조
```
법정동코드 (TEXT): 시군구코드(5자리) + 법정동코드(5자리), 총 10자리
번지 (TEXT): 지번의 본번 부분
호 (TEXT): 지번의 부번 부분 (없으면 '0')
상가건물층주소 (TEXT): 층수 (숫자)
건물층구분코드 (TEXT): '지상층' 또는 '지하층'
전용면적 (TEXT): 전용면적 (㎡)
공유면적 (TEXT): 공유면적 (㎡)
고시가격 (TEXT): 면적당 기준시가 (원/㎡)
```

#### 실거래가 매칭 로직
오피스텔 전월세 실거래가와 기준시가를 매칭하기 위한 조건:

1. **법정동코드 매칭**: `LEFT(sp.법정동코드, 5) = rent.sggcd` (시군구 코드 5자리)
2. **지번 매칭**:
   - 실거래가 지번이 `904-1`인 경우 → 번지 `904`, 호 `1`
   - 실거래가 지번이 `904`인 경우 → 번지 `904`, 호 `0`
   ```sql
   sp.번지::TEXT = SPLIT_PART(rent.jibun, '-', 1)
   AND (
       (NULLIF(SPLIT_PART(rent.jibun, '-', 2), '') IS NULL AND sp.호::TEXT = '0')
       OR sp.호::TEXT = NULLIF(SPLIT_PART(rent.jibun, '-', 2), '')
   )
   ```
3. **층 매칭**:
   - 실거래가 floor가 음수 → 기준시가 `건물층구분코드 = '지하층'`, `상가건물층주소 = ABS(floor)`
   - 실거래가 floor가 0 이상 → 기준시가 `건물층구분코드 = '지상층'`, `상가건물층주소 = floor`
4. **면적 매칭**: `sp.전용면적::FLOAT = rent.excluusear::FLOAT` (완전 일치)

#### 기준시가 계산
```
1. 면적당 기준시가 = 고시가격 (원/㎡)
2. 면적 계 = 전용면적 + 공유면적
3. 기준시가 총액 = 고시가격 × 면적 계
4. 기준시가의 126% = 기준시가 총액 × 1.26
```

#### 보증금 색상 코딩
- **초록색**: 보증금 ≤ 기준시가의 126% (정상)
- **빨간색**: 보증금 > 기준시가의 126% (초과)

#### 툴팁 내용
보증금에 마우스를 올리면 다음 정보를 표시:
```
면적당 기준시가: {고시가격}원/㎡
전용면적: {전용면적}㎡
공유면적: {공유면적}㎡
면적 계: {전용면적 + 공유면적}㎡
기준시가: {기준시가 총액}
기준시가의 126%: {기준시가 × 1.26}
```

#### 성능 최적화
- `LEFT JOIN` 사용으로 단일 쿼리에서 기준시가 데이터 함께 조회
- 실거래가 조회 속도에 영향 없음 (기준시가 데이터 없어도 정상 표시)
- 프론트엔드에서 조건부 색상 적용 (기준시가 데이터 있을 때만)

### 주요 차이점 요약

| 항목 | 아파트 | 연립다세대 | 단독다가구 | 오피스텔 |
|------|--------|-----------|-----------|----------|
| 시군구코드 | col[1] | col[1] | col[1] | col[1] |
| 읍면동명 | col[2] | col[2] | col[3] | col[3] |
| 지번 | col[3] | col[3] | col[4] | col[4] |
| 건물명 | col[4] | col[4] | col[15] | col[5] |
| 면적 | col[5] | col[5] | col[8] | col[6] |
| 층 | col[6] | col[11] | - | col[7] |
| 건축년도 | col[7] | col[12] | col[14] (특수) | col[8] |
| 계약년 | col[8] | col[6] | col[10] | col[9] |
| 계약월 | col[9] | col[7] | col[10] | col[10] |
| 계약일 | col[10] | col[8] | col[11] | col[11] |
| 보증금 | col[11] | col[9] | col[12] | col[12] |
| 월세 | col[12] | col[10] | col[13] | col[13] |
| 계약기간 형식 | YY.MM~YY.MM | YY.MM~YY.MM | YYYYMM~YYYYMM | YY.MM~YY.MM |

## 사용 방법

1. **주택 유형 선택**: 아파트, 연립다세대, 단독다가구, 오피스텔 중 원하는 유형 체크 (복수 선택 가능)
2. **필터 설정**:
   - 계약만기시기 (선택사항, 예: 202412)
   - 지역 (시도 → 시군구 → 읍면동, 복수 선택 가능)
   - 면적 범위 (㎡, 선택사항)
   - 보증금/월세 범위 (만원 단위, 선택사항)
   - 건축년도 범위 (선택사항)
3. **검색 버튼 클릭**: 조건에 맞는 실거래가 조회 (페이지당 20건)
4. **결과 확인**:
   - 테이블에서 실거래가 정보 확인
   - 스크롤하여 추가 데이터 자동 로드 (무한 스크롤)
   - 건물명 클릭 시 해당 건물의 전체 거래 내역 모달 표시

## API 엔드포인트

- `GET /`: 메인 페이지
- `GET /api/locations/sido`: 시도 목록 조회
- `GET /api/locations/sigungu?sido=시도명`: 시군구 목록 조회
- `GET /api/locations/umd?sido=시도명&sigungu=시군구명`: 읍면동 목록 조회
- `POST /api/search`: 실거래가 데이터 검색 (4가지 주택 유형 통합)
  - Request Body:
    ```json
    {
      "include_apt": true,
      "include_villa": true,
      "include_dagagu": true,
      "include_officetel": true,
      "sido": "서울특별시",
      "sigungu": ["강남구", "서초구"],
      "umd": ["역삼동", "삼성동"],
      "area_min": 60,
      "area_max": 150,
      "deposit_min": 5000,
      "deposit_max": 50000,
      "rent_min": 30,
      "rent_max": 300,
      "build_year_min": 2000,
      "build_year_max": 2023,
      "page": 1,
      "page_size": 20
    }
    ```

## 기술 스택

- **Backend**: Flask (Python)
- **Database**: PostgreSQL (psycopg3)
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **기타**: python-dotenv

## 주의사항

- 페이지당 20건씩 조회되며, 무한 스크롤로 추가 데이터 로드 가능
- 보증금, 월세 금액은 모두 만원 단위로 입력
- **필수 입력 항목**: 계약만기시기 + 최소 1개 이상의 시군구 (성능 최적화를 위한 필수 조건)
- **계약만기시기**: 드롭다운에서 선택 (현재 월부터 24개월 옵션 제공)
  - **만기 날짜만 검색**: `~25.12` 또는 `~202512`로 끝나는 계약만 필터링
  - 아파트/연립다세대/오피스텔: YYYYMM → YY.MM 자동 변환 (202512 → `~25.12`)
  - 단독다가구: YYYYMM 그대로 사용 (202512 → `~202512`)
  - ⚠️ 주의: 계약 시작 날짜(예: `25.12~26.12`)는 제외됨
- lawd_code.csv 파일이 ./files/ 경로에 있어야 함 (UTF-8 BOM 인코딩)
- 시군구 선택 시 자동 선택되지 않으므로, 원하는 지역을 수동으로 체크해야 함
- 읍면동은 시군구 선택 시 자동으로 모든 항목이 체크됨

## 개발 가이드라인 (⚠️ 필독)

**중요**: 이 프로젝트는 최소한의 파일 구조로 유지됩니다. 불필요한 스크립트 파일을 생성하지 마세요!

### 파일 수정 원칙
- **코어 파일만 수정**: `app.py`, `main.js`, `style.css`, `index.html` 파일만 수정
- **임시 스크립트 금지**: 테스트, 분석, 수정용 임시 Python 스크립트 생성 금지
- **직접 수정**: 버그 수정이나 기능 추가 시 코어 파일을 직접 수정
- **문서화**: 중요한 변경사항은 반드시 README.md에 기록

### 절대 생성 금지 파일 패턴
```
add_*.py
analyze_*.py
check_*.py
clean_*.py
debug_*.py
fix_*.py
test_*.py
update_*.py
adjust_*.py
... 기타 모든 임시 스크립트
```

### 올바른 개발 방식
✅ **좋은 예**: app.py 파일을 직접 열어서 함수 수정
✅ **좋은 예**: main.js에서 버그가 있는 부분을 찾아 직접 수정
✅ **좋은 예**: style.css에 필요한 스타일 직접 추가

❌ **나쁜 예**: fix_dagagu.py 같은 임시 스크립트 생성
❌ **나쁜 예**: test_query.py로 테스트 후 수동으로 app.py에 적용
❌ **나쁜 예**: analyze_columns.py로 분석 후 따로 수정

## 기술 상세

### 단독다가구 데이터 처리 (⚠️ 수정 금지)

**중요**: 단독다가구 테이블은 다른 유형과 구조가 다릅니다. 컬럼 매핑을 절대 수정하지 마세요!

#### 테이블 컬럼 구조 (인덱스 기준)
```
0: id
1: sggcd (시군구코드)
2: bjdcd (법정동코드)
3: umdnm (읍면동명)
4: jibun (지번)
5: bonbun (본번)
6: bubun (부번)
7: 대지권면적
8: 전용면적 ← 면적으로 표시
9: 계약년월일
10: 계약년 ← YYYYMM 형식의 계약년월
11: 계약일
12: 보증금 ← 보증금으로 표시
13: 월세 ← 월세로 표시
14: 건축년도 ← INTEGER로 캐스팅하여 소수점 제거
15: 건물명 ← 단지명으로 표시
16: 계약기간 ← YYYYMM~YYYYMM 형식
17: 계약구분
18: 갱신요구권사용
19: 종전계약보증금
20: 종전계약월세
21: 층정보 ← NULL/빈값일 때 "-"로 표시
22: created_at
```

#### 특수 처리 사항
1. **건축년도**: `CAST(CAST(건축년도 AS FLOAT) AS INTEGER)` 사용하여 소수점 제거
   - DB 저장 형식: 문자열 `"1999.0"`
   - FLOAT으로 먼저 변환 후 INTEGER로 변환
   - 표시 값: `1999`

2. **층 정보**: 무조건 `-` 표시
   - DB의 층정보 컬럼에는 "단독", "다가구" 같은 주택유형이 저장되어 있음
   - 실제 층수가 아니므로 모든 단독다가구 데이터는 층 컬럼에 `-` 표시
   - SQL: `'-' as 층`

3. **계약기간 형식**: `YYYYMM~YYYYMM` (다른 유형은 `YY.MM~YY.MM`)
   - 예: `202508~202608`
   - 계약만기시기 필터도 YYYYMM 형식 그대로 사용

#### 컬럼 매핑 (절대 수정 금지)
```sql
SELECT
    '단독다가구' as 구분,
    sggcd as 시군구코드,
    umdnm as 읍면동리,
    jibun as 지번,
    col_names[15] as 단지명,
    COALESCE(NULLIF(col_names[21], ''), '-') as 층,
    col_names[8] as 면적,
    col_names[12] as 보증금,
    col_names[13] as 월세,
    col_names[10] as 계약년월,
    col_names[11] as 계약일,
    CAST(CAST(col_names[14] AS FLOAT) AS INTEGER) as 건축년도,  -- 소수점 제거
    col_names[17] as 계약구분,
    col_names[16] as 계약기간,
    col_names[19] as 종전계약보증금,
    col_names[20] as 종전계약월세,
    col_names[18] as 갱신요구권사용
FROM dagagu_rent_transactions
```

### 시도명 축약 표시 (⚠️ 수정 금지)

**중요**: 모든 유형의 실거래가에서 시도명은 2글자 축약형으로 표시됩니다.

#### 축약 매핑 (SIDO_ABBR)
```python
SIDO_ABBR = {
    '서울특별시': '서울',
    '부산광역시': '부산',
    '대구광역시': '대구',
    '인천광역시': '인천',
    '광주광역시': '광주',
    '대전광역시': '대전',
    '울산광역시': '울산',
    '세종특별자치시': '세종',
    '경기도': '경기',
    '강원도': '강원',
    '충청북도': '충북',
    '충청남도': '충남',
    '전라북도': '전북',
    '전북특별자치도': '전북',
    '전라남도': '전남',
    '경상북도': '경북',
    '경상남도': '경남',
    '제주특별자치도': '제주'
}
```

#### 적용 방법
```python
# 모든 유형(아파트, 연립다세대, 오피스텔, 단독다가구)에 동일하게 적용
sido_full = REGIONS['sigungu'][sgg_code]['sido']
row['시도'] = SIDO_ABBR.get(sido_full, sido_full)  # 축약형 사용
```

- 표시 예: `서울`, `경기`, `부산`, `경북`, `경남` 등
- 축약형이 없는 경우 전체 이름 그대로 표시

### 무한 스크롤 구현 (⚠️ 수정 금지)

**중요**: 무한 스크롤 has_more 로직은 정확히 구현되어 있습니다. 절대 수정하지 마세요!

#### 동작 원리
1. **각 주택 유형별 조회 건수 추적**: `result_counts = []` 리스트에 아파트, 연립다세대, 오피스텔, 단독다가구 각각의 조회 건수를 저장
2. **page_size별 조회**: 각 유형마다 `LIMIT page_size OFFSET offset`으로 조회 (기본 20건)
3. **has_more 판단 로직**:
   ```python
   has_more = any(count == page_size for count in result_counts)
   ```
   - 어떤 유형이라도 정확히 `page_size`만큼 조회되었다면 → 더 있을 가능성 있음 → `has_more = True`
   - 모든 유형이 `page_size`보다 적게 조회되었다면 → 더 없음 → `has_more = False`

#### 잘못된 구현 사례 (절대 사용 금지)
```python
# ❌ 잘못됨: all_results는 4개 유형 합쳐서 최대 80건이 될 수 있음
has_more = len(all_results) >= page_size

# ✅ 올바름: 각 유형별로 page_size와 비교
has_more = any(count == page_size for count in result_counts)
```

#### 왜 이렇게 구현해야 하는가?
- 4가지 주택 유형을 동시에 조회하므로, `all_results`는 최대 80건(20 x 4)이 될 수 있음
- 하지만 각 유형은 20건씩만 조회했으므로, 유형별로 더 있는지 판단해야 함
- 예: 아파트 20건, 연립다세대 5건 조회 → 아파트는 더 있을 수 있지만 연립다세대는 더 없음

## 최근 업데이트 내역

### 2025-11-07 (v2.6)
- **소유자 정보 조회 기능 추가**: VWorld API 연동으로 건물별 소유자 정보 확인 가능
  - **건물 모달 탭 추가**: 기존 실거래가 탭 + 새로운 소유자 정보 탭
  - **VWorld API 연동**: 토지소유정보속성조회 API 활용
  - **동·호별 그룹화**: 각 호실별 소유자 정보를 표 형태로 표시
  - **소유자 수 표시**: 공유인수(cnrsPsnCo) + 1로 계산
  - **소유 기간 계산**: 소유권이전/소유권보존 시 자동 계산
    - YYYY-MM-DD 및 YYYYMMDD 형식 모두 지원
    - 표시 형식: "N년 N개월", "N년", "N개월", "1개월 미만"
  - **표시 정보**: 소유자 구분, 소유자 거주지, 소유권변동일자, 소유권변동원인
- **소유권 분포 분석 기능**: 건물 분양 상태 자동 판단
  - **미분양 판단**: 모든 호실이 동일 소유자 → "분양되지 않았으며, 모든 호실을 N명이 소유"
  - **완전 분양 판단**: 모든 호실이 다른 소유자 → "모든 호실이 분양된 것으로 추정"
  - **부분 분양 판단**: 일부만 동일 소유자 → "201호, 202호는 동일 소유자 2명이 소유하고 있으며, 나머지는 분양됨"
  - 2개 이상 호실이 동일 소유자일 때만 그룹으로 표시
- **컬럼명 변경**: "동·호명" → "추정 호실 후보군"
  - 메인 테이블과 모달 테이블 모두 적용
  - 건축물대장 기반 추정 정보임을 명확히 표시
- **모달 UI 개선**: Flexbox 구조로 overflow 문제 해결
  - modal-content: `max-height: 85vh`, `display: flex`, `flex-direction: column`
  - modal-body: `flex: 1`, `overflow-y: auto` (내부 스크롤)
  - 테이블이 모달 밖으로 벗어나지 않도록 수정
- **파일**: `app.py` (VWorld API 통합), `static/js/main.js` (소유권 분석, 기간 계산), `templates/index.html` (탭 UI), `static/css/style.css` (모달 레이아웃)

### 2025-11-07 (v2.5)
- **오피스텔 기준시가 매핑 수정 완료**: 결과 매핑에서 0-padding 제거로 실거래가 데이터와 매칭 성공
  - **문제**: v2.4에서 쿼리는 INTEGER 변환으로 정상 동작하지만, 결과 매핑에서 0-padding이 유지되어 매칭 실패
    - DB 결과: `번지=0506`, `호=0015` (0-padding 포함)
    - 키 생성: `('0506-0015', 13, 20.67)` (padding 유지)
    - 실거래가: `지번=506-15` → 매칭 실패
  - **해결**: 결과 매핑 시 INTEGER 변환으로 padding 제거
    ```python
    # 변경 전
    bunji = str(db_row['번지']).strip()  # "0506"
    ho = str(db_row['호']).strip()       # "0015"

    # 변경 후
    bunji = str(int(db_row['번지']))  # "506" (padding 제거)
    ho = str(int(db_row['호']))       # "15" (padding 제거)
    ```
  - **개선 효과**:
    - 망우동 506-15 13층 전용 20.67 등 기존 미매칭 건 모두 매칭 성공
    - 오피스텔 기준시가 매칭률 95%+ 달성 예상
  - **파일**: `app.py:1188-1189 (fetch_officetel_standard_prices_batch 함수)`
- **연립다세대 defaultdict import 오류 수정**: 누락된 import 문 추가
  - **문제**: 공동주택가격 일괄 조회 시 "cannot access local variable 'defaultdict'" 오류 발생
  - **해결**: `from collections import defaultdict` 추가
  - **파일**: `app.py:1897 (연립다세대 섹션)`

### 2025-11-05 (v2.4)
- **오피스텔 기준시가 매칭률 대폭 개선**: INTEGER 변환 + Regex 필터로 데이터 품질 문제 해결
  - **문제 1 - 패딩 불일치**: 기준시가 `번지=0094`, `호=0208` (앞자리 0 패딩) vs 실거래가 `지번=94-208` → TEXT 비교로 매칭 실패
  - **해결 1 - INTEGER 변환**: `sp.번지::INTEGER = SPLIT_PART(rent.jibun, '-', 1)::INTEGER`로 패딩 무시
    - 예: `0094` → `94`, `0208` → `208`로 정규화되어 비교
  - **문제 2 - 비숫자 데이터**: `상가건물층주소` 컬럼에 "00C3" 같은 16진수 값 존재 → `::INTEGER` 변환 시 PostgreSQL 에러
  - **해결 2 - Regex 사전 필터링**: `sp.상가건물층주소 ~ '^[0-9]+$'`로 숫자만 선택
    - PostgreSQL Regex 패턴 `^[0-9]+$`: 전체 문자열이 0~9 숫자로만 구성
    - 비숫자 값 사전 제거로 INTEGER 변환 에러 방지
  - **최종 JOIN 조건**:
    ```sql
    LEFT JOIN officetel_standard_price sp ON
        LEFT(sp.법정동코드, 5) = rent.sggcd
        AND sp.번지 ~ '^[0-9]+$' AND sp.번지::INTEGER = SPLIT_PART(rent.jibun, '-', 1)::INTEGER
        AND sp.호 ~ '^[0-9]+$' AND sp.호::INTEGER = NULLIF(SPLIT_PART(rent.jibun, '-', 2), '')::INTEGER
        AND sp.상가건물층주소 ~ '^[0-9]+$'
        AND (층 매칭 조건...)
        AND sp.전용면적::FLOAT = rent.excluusear::FLOAT
    ```
  - **개선 효과**:
    - 신림동 94-208 사례: 기준시가 1~8층 데이터(91건) 존재, 실거래가 2~8층(316건) 모두 매칭 성공
    - 매칭률 83.1% → 예상 95%+ 향상
  - **파일**: `app.py:1309-1311 (메인 쿼리), 1736-1738 (모달 쿼리)`
- **오피스텔 기준시가 툴팁 완전 재구현**: CSS pseudo-element → JavaScript DOM 방식
  - **문제**: CSS `content: attr(data-tooltip)`로는 `\n` 개행이 표시되지 않아 검은 라인만 보임
    - CSS `white-space: pre`, `pre-line` 모두 `attr()` 함수와 호환 불가
  - **해결**: JavaScript로 실제 DOM 요소(`<div>`) 생성 및 `innerHTML`로 `<br>` 태그 렌더링
  - **핵심 함수**:
    - `createTooltip()`: 툴팁 `<div>` 생성 및 `position: fixed` 스타일 적용
    - `showTooltip(target)`: 툴팁 위치 계산 (대상 위/아래, 화면 경계 체크) 및 표시
    - `hideTooltip()`: 툴팁 숨김
  - **이벤트 처리**:
    - `mouseover`: 즉시 툴팁 표시 (딜레이 없음)
    - `mouseout`: 클릭 고정 상태 아니면 숨김
    - `click`: 툴팁 고정/해제 토글 (`tooltip-active` 클래스)
  - **UX 개선**:
    - 6줄 내용 정상 표시: 면적당 기준시가, 전용/공유면적, 면적 계, 기준시가, 126%
    - 화면 밖으로 나가면 자동 위치 조정 (위 → 아래, 좌/우 경계)
    - 여러 툴팁 동시 표시 방지 (다른 툴팁 자동 닫힘)
  - **파일**: `static/js/main.js:47-82 (HTML 생성), 904-1013 (이벤트), static/css/style.css:527-530 (스타일)`
- **오피스텔 모달 정렬 순서 수정**: 최신순(계약년월 DESC) 표시
  - **문제**: `DISTINCT ON (rent.id)`로 중복 제거 시 `ORDER BY id`가 우선되어 임의 순서 표시
  - **해결**: 서브쿼리 패턴으로 중복 제거 후 재정렬
    ```sql
    SELECT * FROM (
        SELECT DISTINCT ON (rent.id) ..., dealyear as dealyear_sort, dealmonth as dealmonth_sort, ...
        ORDER BY rent.id, rent.dealyear DESC, rent.dealmonth DESC, ...
    ) sub
    ORDER BY dealyear_sort DESC, dealmonth_sort DESC, dealday_sort DESC
    ```
  - **파일**: `app.py:1710-1754`

### 2025-11-05 (v2.3)
- (이전 버전, v2.4로 통합됨)

### 2025-11-05 (v2.2)
- **오피스텔 기준시가 검증 기능 추가**: 보증금이 기준시가의 126%를 초과하는지 실시간 표시
  - officetel_standard_price 테이블과 실거래가 데이터를 LEFT JOIN으로 매칭
  - 복잡한 매칭 로직: 법정동코드(5자리), 지번(번지/호 분리), 층(지상/지하), 전용면적 완전 일치
  - 보증금 색상 코딩: 초록색(126% 이하), 빨간색(126% 초과)
  - 마우스 오버 시 상세 계산 툴팁 표시:
    - 면적당 기준시가, 전용면적, 공유면적, 면적 계
    - 기준시가 총액, 기준시가의 126%
  - 성능 최적화: 단일 쿼리로 조회하여 속도 저하 없음
  - 메인 테이블과 모달 테이블 모두 적용
  - 오피스텔 데이터만 적용 (다른 유형은 변경 없음)
- **README.md 문서화**: officetel_standard_price 테이블 구조 및 매칭 로직 상세 설명

### 2025-11-05 (v2.1)
- **모달 ORDER BY 절 수정**: PostgreSQL 별칭 참조 오류 해결
  - 문제: ORDER BY에서 SELECT 별칭(계약일, 계약년월)을 직접 사용하여 "column does not exist" 오류 발생
  - 해결: 원본 컬럼명을 ORDER BY에서 직접 사용하도록 수정
  - 단독다가구: `"{col_names[10]}" DESC, CAST(NULLIF("{col_names[11]}", '') AS INTEGER) DESC`
  - 연립다세대: `CONCAT(...col[6], col[7]) DESC, CAST(NULLIF("{col_names[8]}", '') AS INTEGER) DESC`
  - 오피스텔: `CONCAT(...col[9], col[10]) DESC, CAST(NULLIF("{col_names[11]}", '') AS INTEGER) DESC`
  - 아파트: `CONCAT(...col[8], col[9]) DESC, CAST(NULLIF("{col_names[10]}", '') AS INTEGER) DESC`
- **README 스키마 문서화**: 4가지 주택 유형의 완전한 컬럼 구조 문서화
  - 각 테이블별 전체 컬럼 인덱스와 용도 명시
  - 모달 쿼리 ORDER BY 예시 추가
  - 주요 차이점 요약 테이블 추가
  - 향후 컬럼 인덱스 혼동 방지

### 2025-11-05 (v2.0)
- **계약만기시기 필수값 변경**: 드롭다운으로 변경 및 필수 입력 항목으로 지정
  - 변경 전: 선택사항 text input
  - 변경 후: 필수 select dropdown (현재 월부터 24개월 옵션)
  - 프론트엔드(main.js) 및 백엔드(app.py) 양쪽 검증 추가
- **필수 입력 항목 강화**: 계약만기시기 + 최소 1개 이상의 시군구
  - 성능 최적화를 위한 필수 조건
  - 검색 시도 시 누락된 필수값에 대한 명확한 오류 메시지 표시
  - 전체 데이터베이스 스캔 방지
- **UX 개선**:
  - 계약만기시기 필드에 빨간 별표(*) 표시
  - 드롭다운 옵션 자동 생성 (YYYY년 MM월 형식)
  - 필수값 누락 시 alert으로 즉시 알림

### 2025-11-05 (v1.9)
- **프로젝트 파일 정리**: 불필요한 임시 스크립트 파일 모두 삭제
  - add_*.py, analyze_*.py, fix_*.py, test_*.py 등 모든 임시 파일 제거
  - 코어 파일만 남김: app.py, main.js, style.css, index.html
- **개발 가이드라인 추가**: README에 파일 수정 원칙 문서화
  - 임시 스크립트 생성 금지 정책 명시
  - 코어 파일 직접 수정 방식으로 통일
  - 향후 불필요한 파일 생성 방지
- **면적 표시 정밀도 개선**: 소수점 제한 제거하여 DB 원본 값 그대로 표시
  - 변경 전: parseFloat(row.면적).toFixed(1) → 84.9
  - 변경 후: row.면적 → 84.97
  - 메인 테이블과 모달 테이블 모두 적용

### 2025-11-05 (v1.8)
- **단독다가구 건축년도 소수점 제거**: CAST(CAST(건축년도 AS FLOAT) AS INTEGER) 적용
  - DB 저장 형식: 문자열 `"1999.0"`
  - 2단계 변환: 문자열 → FLOAT → INTEGER
  - 표시 값: `1999`
  - 건축년도 필터에도 동일한 캐스팅 적용
- **단독다가구 층 정보 처리**: COALESCE(NULLIF(층정보, ''), '-') 적용
  - NULL이거나 빈 문자열일 때 `-` 표시
  - 단독다가구는 대부분 층 정보가 없어 특별 처리 필요
- **시도명 축약 표시**: 모든 유형에서 시도명을 2글자 축약형으로 표시
  - 서울특별시 → `서울`, 경상북도 → `경북`, 경기도 → `경기` 등
  - SIDO_ABBR 매핑 사전 사용하여 변환
  - 4가지 주택 유형 모두 동일하게 적용
- **무한 스크롤 CSS 수정**: `.table-container`에 `overflow-y: auto`, `max-height: 600px` 추가
  - 테이블 세로 스크롤 활성화
  - 스크롤 이벤트 정상 감지되도록 수정
- **README 상세 문서화**: 단독다가구 컬럼 매핑 및 시도명 축약 로직 문서화
  - 향후 동일 실수 방지를 위한 상세 가이드 추가
  - 절대 수정 금지 경고 표시

### 2025-11-05 (v1.7)
- **무한 스크롤 has_more 로직 수정**: 주택 유형별 조회 건수 추적으로 정확도 향상
  - 변경 전: `len(all_results) >= page_size` (부정확)
  - 변경 후: `any(count == page_size for count in result_counts)` (정확)
  - 각 주택 유형별로 조회 건수를 추적하여 정확한 판단
- **읍면동 필터 추가**: 4가지 주택 유형 모두에 읍면동 필터 적용
  - 선택한 읍면동만 정확히 검색되도록 개선
  - 검색 속도 향상 (불필요한 데이터 스캔 제거)
- **단독다가구 컬럼 매핑 수정**: 면적, 보증금, 월세 등 정확한 인덱스로 수정
  - 면적 NaN 문제 해결
  - 컬럼 인덱스 오류로 인한 데이터 표시 불일치 해결

### 2025-11-04 (v1.6)
- **계약만기시기 검색 시 지역 필터 필수화**: 성능 최적화를 위한 필수 조건
  - 계약만기시기만으로 검색 시 에러 메시지 표시
  - 최소한 시군구를 선택해야 검색 가능
  - 890만 건의 전체 데이터 스캔 방지

### 2025-11-04 (v1.5)
- **계약만기시기 검색 성능 개선**: LIKE 패턴에서 SPLIT_PART 함수로 변경
  - 변경 전: `LIKE '%~25.12'` (전체 테이블 스캔, 매우 느림)
  - 변경 후: `SPLIT_PART(contractterm, '~', 2) = '25.12'` (정확한 비교)
  - 4가지 주택 유형 모두 적용
  - 지역 필터와 함께 사용 필수

### 2025-11-04 (v1.4)
- **지역 필터 정확도 개선**: 시도와 시군구를 함께 확인하여 정확한 지역만 검색
  - 문제: 인천 중구 검색 시 대구 중구, 서울 중구 등도 함께 검색됨
  - 해결: 시도와 시군구 이름을 모두 확인하여 정확한 지역 코드만 선택
- **단독다가구 정렬 오류 수정**: ORDER BY 절에서 존재하지 않는 계약일 컬럼 제거
  - 계약일 컬럼이 없어서 발생한 정렬 오류 해결
  - 계약년월만으로 정렬하도록 변경

### 2025-11-04 (v1.3)
- **단독다가구 컬럼 인덱스 수정**: 테이블 컬럼 매핑 오류 해결
  - 보증금, 월세, 건축년도 등 모든 컬럼이 정확한 위치에 표시되도록 수정
  - 계약만기시기 필터가 단독다가구에서도 정상 작동하도록 수정
  - 컬럼 인덱스 오류로 인한 데이터 표시 불일치 문제 해결

### 2025-11-04 (v1.2)
- **계약만기시기 필터 추가**: YYYYMM 형식으로 입력하여 계약 만기 시기로 검색 가능
  - **만기 날짜만 정확히 검색**: `~YY.MM` 또는 `~YYYYMM`로 끝나는 계약만 필터링
  - 계약 시작 날짜(예: `25.12~26.12`)는 검색에서 제외
  - 4가지 주택 유형별 계약기간 형식 차이 자동 처리
  - 아파트/연립다세대/오피스텔: YYYYMM → `~YY.MM` 변환 (예: 202512 → `~25.12`)
  - 단독다가구: YYYYMM → `~YYYYMM` 변환 (예: 202512 → `~202512`)
- **README.md 상세화**: 데이터베이스 테이블별 계약기간 형식 및 필터 로직 명시
  - 같은 실수 방지를 위한 중요 정보 문서화
  - 계약만기시기 필터의 정확한 동작 방식 설명

### 2025-11-04 (v1.1)
- **보증금 표시 개선**: 만원 단위를 억/만원 표시로 변경
  - 8,000만원 → "8,000"
  - 1억 4,000만원 → "1억 4,000"
  - 12억 → "12억"
- **계약기간 컬럼 너비 확장**: 70px → 120px (전체 내용 표시 가능)
- **보증금/월세 컬럼 너비 확장**: 가독성 향상

### 2025-11-04 (v1.0)
- **4가지 주택 유형 지원**: 아파트, 연립다세대, 단독다가구, 오피스텔 데이터 통합 조회
- **성능 최적화**: DOM 캐싱, 이벤트 디바운싱, DocumentFragment 활용
- **시군구 자동선택 제거**: 사용자가 명시적으로 선택하도록 변경
- **건물별 상세 조회**: 건물명 클릭 시 모달로 전체 거래 내역 표시
- **API 엔드포인트 변경**: `/api/transactions` → `/api/search`로 통합
- **무한 스크롤**: 스크롤 시 자동으로 다음 페이지 로드

## 개발자

Claude Code를 활용하여 개발되었습니다.
