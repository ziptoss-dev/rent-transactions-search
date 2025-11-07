from flask import Flask, render_template, request, jsonify
import psycopg
from psycopg.rows import dict_row
import os
from dotenv import load_dotenv
import csv
import requests
import xml.etree.ElementTree as ET
import sys
import io

# Windows 콘솔 인코딩 문제 해결
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# 환경 변수 로드
load_dotenv()

app = Flask(__name__)

# 안전한 print 함수 (Windows 콘솔 인코딩 문제 방지)
_builtin_print = print
def safe_print(*args, **kwargs):
    """Windows 콘솔 인코딩 오류를 방지하는 안전한 print 함수"""
    try:
        _builtin_print(*args, **kwargs)
    except (UnicodeEncodeError, OSError):
        # 인코딩 오류 발생 시 무시
        pass

# 전역 print를 safe_print로 대체
import builtins
builtins.print = safe_print

# DB 연결 설정
DB_CONFIG = {
    'host': os.getenv('PG_HOST'),
    'dbname': os.getenv('PG_DB'),
    'user': os.getenv('PG_USER'),
    'password': os.getenv('PG_PASSWORD'),
    'port': os.getenv('PG_PORT'),
    'connect_timeout': 30
}

# 간단한 DB 연결 풀 (서버리스 환경 최적화)
_db_connection = None

def get_db_connection():
    """DB 연결 재사용 (서버리스 환경에서 성능 개선)"""
    global _db_connection
    try:
        # 기존 연결이 있고 유효하면 재사용
        if _db_connection is not None and not _db_connection.closed:
            # 간단한 연결 테스트
            cursor = _db_connection.cursor()
            cursor.execute('SELECT 1')
            cursor.close()
            return _db_connection
    except:
        pass

    # 새 연결 생성
    _db_connection = psycopg.connect(**DB_CONFIG, row_factory=dict_row)
    return _db_connection

# 시도명 축약 매핑
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

# 지역 코드 데이터 로드
def load_region_codes():
    """lawd_code.csv 파일에서 지역 코드 로드"""
    regions = {
        'sido': {},  # 시도
        'sigungu': {},  # 시군구
        'umd': {}  # 읍면동
    }

    with open('./files/lawd_code.csv', 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            # 삭제일자가 없는 것만 사용
            if row['삭제일자']:
                continue

            code = row['법정동코드']
            sido_name = row['시도명']
            sigungu_name = row['시군구명']
            umd_name = row['읍면동명']

            # 시도 코드 (앞 2자리)
            sido_code = code[:2]
            if sido_code + '00000000' == code and sido_name:
                regions['sido'][sido_code] = sido_name

            # 시군구 코드 (앞 5자리)
            sgg_code = code[:5]
            if sgg_code + '00000' == code and sigungu_name:
                regions['sigungu'][sgg_code] = {
                    'name': sigungu_name,
                    'sido': sido_name,
                    'sido_code': sido_code
                }

            # 읍면동 코드 (전체 10자리)
            if umd_name and code[5:] != '00000':
                ri_name = row['리명']
                # 체크박스에는 읍면동명만 표시 (리명 제외)
                display_name = umd_name
                regions['umd'][code] = {
                    'name': display_name,
                    'umd_name': umd_name,
                    'ri_name': ri_name,
                    'sigungu': sigungu_name,
                    'sido': sido_name,
                    'sgg_code': sgg_code
                }

    return regions

# 지역 코드 로드
REGIONS = load_region_codes()

# 건물명 캐시 로드 (자동완성 성능 최적화)
def load_building_cache():
    """건물명 목록을 메모리에 캐싱 (자동완성 성능 향상)"""
    print("건물명 캐시 로딩 중...")
    cache = {}  # {umd_name: [(sgg_code, jibun, building_name, property_type), ...]}

    try:
        print("  [1/4] 데이터베이스 연결 중...")
        conn = get_db_connection()
        cursor = conn.cursor()
        print("  [OK] 데이터베이스 연결 성공")

        tables = [
            ('apt_rent_transactions', 'aptnm', '아파트'),
            ('villa_rent_transactions', 'mhousename', '연립다세대'),
            ('officetel_rent_transactions', 'offinm', '오피스텔'),
            ('dagagu_rent_transactions', 'NULL', '단독다가구')
        ]

        for idx, (table_name, building_col, property_type) in enumerate(tables, start=2):
            print(f"  [{idx}/4] {property_type} 테이블 로딩 중...")
            query = f"""
                SELECT DISTINCT sggcd, umdnm, jibun, {building_col} as building_name
                FROM {table_name}
                WHERE umdnm IS NOT NULL AND jibun IS NOT NULL
                LIMIT 100000
            """
            cursor.execute(query)

            row_count = 0
            for row in cursor.fetchall():
                umd_name = row['umdnm']
                if umd_name not in cache:
                    cache[umd_name] = []

                cache[umd_name].append({
                    'sgg_code': row['sggcd'],
                    'jibun': row['jibun'],
                    'building_name': row['building_name'],
                    'property_type': property_type
                })
                row_count += 1

            print(f"  [OK] {property_type} 완료: {row_count}건")

        cursor.close()

        # 각 읍면동별로 지번 순으로 정렬
        print("  [정리] 데이터 정렬 중...")
        for umd_name in cache:
            cache[umd_name].sort(key=lambda x: x['jibun'])

        total_buildings = sum(len(v) for v in cache.values())
        print(f"[완료] 건물명 캐시 로딩 완료: {len(cache)}개 읍면동, {total_buildings:,}건 데이터")
    except Exception as e:
        print(f"[ERROR] 건물명 캐시 로딩 실패: {str(e)}")
        print("빈 캐시로 계속 진행합니다. 건물 검색 기능이 제한될 수 있습니다.")
        import traceback
        traceback.print_exc()

    return cache

# BUILDING_CACHE = load_building_cache()  # 초기 로딩 속도 개선을 위해 비활성화
BUILDING_CACHE = {}  # 빈 캐시 (실시간 DB 검색 사용)

def abbreviate_sido_name(sido_name):
    """시도명을 2글자로 축약"""
    abbreviations = {
        '서울특별시': '서울',
        '부산광역시': '부산',
        '대구광역시': '대구',
        '인천광역시': '인천',
        '광주광역시': '광주',
        '대전광역시': '대전',
        '울산광역시': '울산',
        '세종특별자치시': '세종',
        '경기도': '경기',
        '강원특별자치도': '강원',
        '충청북도': '충북',
        '충청남도': '충남',
        '전북특별자치도': '전북',
        '전라남도': '전남',
        '경상북도': '경북',
        '경상남도': '경남',
        '제주특별자치도': '제주'
    }
    return abbreviations.get(sido_name, sido_name[:2])

def format_money(money_str):
    """보증금/월세 포맷팅 (쉼표 제거 후 억단위 표시)"""
    if not money_str or money_str == '':
        return '0'

    # 이미 포맷팅된 값인지 확인 (억이 포함되어 있으면)
    if '억' in str(money_str):
        return str(money_str)

    try:
        # 쉼표 제거하고 숫자로 변환
        amount = int(str(money_str).replace(',', ''))

        if amount >= 10000:
            eok = amount // 10000
            man = amount % 10000
            if man == 0:
                return f'{eok}억'
            else:
                return f'{eok}억{man}'
        else:
            return str(amount)
    except ValueError:
        return str(money_str)

@app.route('/')
def index():
    """메인 페이지"""
    return render_template('index.html')

@app.route('/api/regions/sido')
def get_sido_list():
    """시도 목록 조회"""
    sido_list = [
        {'code': code, 'name': name}
        for code, name in sorted(REGIONS['sido'].items())
    ]
    return jsonify(sido_list)

@app.route('/api/regions/sigungu/<sido_code>')
def get_sigungu_list(sido_code):
    """시군구 목록 조회 (DB에서 직접)"""
    conn = get_db_connection()
    cursor = conn.cursor()

    # 4가지 테이블에서 시군구 코드 수집
    sigungu_set = set()

    try:
        # 아파트
        cursor.execute(f"SELECT DISTINCT sggcd FROM apt_rent_transactions WHERE sggcd LIKE '{sido_code}%'")
        sigungu_set.update([row['sggcd'] for row in cursor.fetchall()])

        # 연립다세대
        cursor.execute(f"SELECT DISTINCT sggcd FROM villa_rent_transactions WHERE sggcd LIKE '{sido_code}%'")
        sigungu_set.update([row['sggcd'] for row in cursor.fetchall()])

        # 오피스텔
        cursor.execute(f"SELECT DISTINCT sggcd FROM officetel_rent_transactions WHERE sggcd LIKE '{sido_code}%'")
        sigungu_set.update([row['sggcd'] for row in cursor.fetchall()])

        # 단독다가구
        cursor.execute(f"SELECT DISTINCT sggcd FROM dagagu_rent_transactions WHERE sggcd LIKE '{sido_code}%'")
        sigungu_set.update([row['sggcd'] for row in cursor.fetchall()])

    finally:
        cursor.close()
        conn.close()

    # lawd_code.csv에서 시군구 이름 매핑 (없으면 코드만 사용)
    sigungu_list = []
    for code in sorted(sigungu_set):
        name = REGIONS['sigungu'].get(code, {}).get('name', code)
        sigungu_list.append({'code': code, 'name': name})

    return jsonify(sigungu_list)

@app.route('/api/regions/umd/<sgg_code>')
def get_umd_list(sgg_code):
    """읍면동 목록 조회 (DB에서 직접, 중복 제거)"""
    conn = get_db_connection()
    cursor = conn.cursor()

    # 4가지 테이블에서 읍면동명 수집
    umd_set = set()

    try:
        # 아파트
        cursor.execute(f"SELECT DISTINCT umdnm FROM apt_rent_transactions WHERE sggcd = '{sgg_code}'")
        umd_set.update([row['umdnm'] for row in cursor.fetchall() if row['umdnm']])

        # 연립다세대
        cursor.execute(f"SELECT DISTINCT umdnm FROM villa_rent_transactions WHERE sggcd = '{sgg_code}'")
        umd_set.update([row['umdnm'] for row in cursor.fetchall() if row['umdnm']])

        # 오피스텔
        cursor.execute(f"SELECT DISTINCT umdnm FROM officetel_rent_transactions WHERE sggcd = '{sgg_code}'")
        umd_set.update([row['umdnm'] for row in cursor.fetchall() if row['umdnm']])

        # 단독다가구
        cursor.execute(f"SELECT DISTINCT umdnm FROM dagagu_rent_transactions WHERE sggcd = '{sgg_code}'")
        umd_set.update([row['umdnm'] for row in cursor.fetchall() if row['umdnm']])

    finally:
        cursor.close()
        conn.close()

    # 읍면동명 리스트 생성
    umd_list = [{'code': umd_name, 'name': umd_name} for umd_name in sorted(umd_set) if umd_name]
    return jsonify(umd_list)

@app.route('/api/transactions', methods=['POST'])
def get_transactions():
    """실거래가 조회"""
    try:
        filters = request.get_json()

        contract_end = filters.get('contract_end')
        sido_code = filters.get('sido_code')
        sgg_codes = filters.get('sgg_codes')
        umd_codes = filters.get('umd_codes')
        deposit_min = filters.get('deposit_min')
        deposit_max = filters.get('deposit_max')
        monthly_min = filters.get('rent_min')
        monthly_max = filters.get('rent_max')
        build_year_min = filters.get('build_year_min')
        build_year_max = filters.get('build_year_max')
        include_apt = filters.get('include_apt', True)
        include_villa = filters.get('include_villa', True)
        include_dagagu = filters.get('include_dagagu', True)
        include_officetel = filters.get('include_officetel', True)

        # 페이지네이션 파라미터 추가
        page = filters.get('page', 1)
        page_size = filters.get('page_size', 20)  # 기본 20개
        offset = (page - 1) * page_size

        # 페이지네이션 파라미터 추가
        page = filters.get('page', 1)
        page_size = filters.get('page_size', 20)  # 기본 20개
        offset = (page - 1) * page_size

        all_results = []

        conn = get_db_connection()
        cursor = conn.cursor()

        # 아파트 조회
        if include_apt:
            apt_query = """
                SELECT
                    sggcd,
                    umdnm,
                    jibun,
                    aptnm,
                    excluusear as 계약면적,
                    dealyear || LPAD(dealmonth, 2, '0') as 계약년월,
                    dealday as 계약일,
                    deposit as 보증금,
                    monthlyrent as 월세금,
                    floor as 층,
                    buildyear as 건축년도,
                    contracttype as 계약구분,
                    contractterm as 계약기간,
                    predeposit as 종전계약보증금,
                    premonthlyrent as 종전계약월세,
                    userrright as 갱신요구권사용
                FROM apt_rent_transactions
                WHERE 1=1
            """
            apt_params = []

            # 계약만기시기 필터
            if contract_end:
                # YYYYMM 형식을 YY.MM 형식으로 변환 (예: 202709 -> 27.09)
                if len(contract_end) == 6:  # YYYYMM 형식
                    short_format = contract_end[2:4] + '.' + contract_end[4:6]  # 27.09
                    apt_query += " AND contractterm LIKE %s"
                    apt_params.append(f'%{short_format}')
                else:
                    apt_query += " AND contractterm LIKE %s"
                    apt_params.append(f'%{contract_end}')

            # 지역 필터
            if umd_codes and len(umd_codes) > 0:
                # 읍면동 선택 시 - 선택된 읍면동들의 시군구와 읍면동 패턴으로 필터링
                sgg_umd_conditions = []
                for umd_code in umd_codes:
                    umd_data = REGIONS['umd'].get(umd_code, {})
                    sgg_code = umd_data.get('sgg_code', '')
                    umd_name = umd_data.get('umd_name', '')
                    if sgg_code and umd_name:
                        # LIKE 패턴으로 해당 읍면동의 모든 리를 포함
                        sgg_umd_conditions.append(f"(sggcd = %s AND umdnm LIKE %s)")
                        apt_params.extend([sgg_code, f'{umd_name}%'])

                if sgg_umd_conditions:
                    apt_query += f" AND ({' OR '.join(sgg_umd_conditions)})"
            elif sgg_codes and len(sgg_codes) > 0:
                # 여러 시군구 선택 시
                placeholders = ','.join(['%s'] * len(sgg_codes))
                apt_query += f" AND sggcd IN ({placeholders})"
                apt_params.extend(sgg_codes)
            elif sido_code:
                # 시도만 선택했을 때 - 해당 시도의 모든 시군구 포함
                sido_sgg_codes = [code for code, data in REGIONS['sigungu'].items() if data['sido_code'] == sido_code]
                if sido_sgg_codes:
                    placeholders = ','.join(['%s'] * len(sido_sgg_codes))
                    apt_query += f" AND sggcd IN ({placeholders})"
                    apt_params.extend(sido_sgg_codes)

            # 보증금 필터
            if deposit_min is not None:
                apt_query += " AND CAST(REPLACE(deposit, ',', '') AS INTEGER) >= %s"
                apt_params.append(deposit_min)
            if deposit_max is not None:
                apt_query += " AND CAST(REPLACE(deposit, ',', '') AS INTEGER) <= %s"
                apt_params.append(deposit_max)

            # 월세 필터
            if monthly_min is not None:
                apt_query += " AND CAST(REPLACE(monthlyrent, ',', '') AS INTEGER) >= %s"
                apt_params.append(monthly_min)
            if monthly_max is not None:
                apt_query += " AND CAST(REPLACE(monthlyrent, ',', '') AS INTEGER) <= %s"
                apt_params.append(monthly_max)

            # 건축년도 필터
            if build_year_min is not None:
                apt_query += " AND CAST(buildyear AS INTEGER) >= %s"
                apt_params.append(build_year_min)
            if build_year_max is not None:
                apt_query += " AND CAST(buildyear AS INTEGER) <= %s"
                apt_params.append(build_year_max)

            apt_query += " ORDER BY 계약년월 DESC, 계약일 DESC LIMIT %s OFFSET %s"
            apt_params.extend([page_size, offset])

            cursor.execute(apt_query, apt_params)
            apt_results = cursor.fetchall()
            for result in apt_results:
                result['source_type'] = 'apt'
            all_results.extend(apt_results)

        # 연립다세대 조회
        if include_villa:
            villa_query = """
                SELECT
                    sggcd,
                    umdnm,
                    jibun,
                    mhousename as aptnm,
                    excluusear as 계약면적,
                    dealyear || LPAD(dealmonth, 2, '0') as 계약년월,
                    dealday as 계약일,
                    deposit as 보증금,
                    monthlyrent as 월세금,
                    floor as 층,
                    buildyear as 건축년도,
                    contracttype as 계약구분,
                    contractterm as 계약기간,
                    predeposit as 종전계약보증금,
                    premonthlyrent as 종전계약월세,
                    userrright as 갱신요구권사용
                FROM villa_rent_transactions
                WHERE 1=1
            """
            villa_params = []

            # 계약만기시기 필터
            if contract_end:
                if len(contract_end) == 6:  # YYYYMM 형식
                    short_format = contract_end[2:4] + '.' + contract_end[4:6]  # 27.09
                    villa_query += " AND contractterm LIKE %s"
                    villa_params.append(f'%{short_format}')
                else:
                    villa_query += " AND contractterm LIKE %s"
                    villa_params.append(f'%{contract_end}')

            # 지역 필터
            if umd_codes and len(umd_codes) > 0:
                # 읍면동 선택 시 - 선택된 읍면동들의 시군구와 읍면동 패턴으로 필터링
                sgg_umd_conditions = []
                for umd_code in umd_codes:
                    umd_data = REGIONS['umd'].get(umd_code, {})
                    sgg_code = umd_data.get('sgg_code', '')
                    umd_name = umd_data.get('umd_name', '')
                    if sgg_code and umd_name:
                        # LIKE 패턴으로 해당 읍면동의 모든 리를 포함
                        sgg_umd_conditions.append(f"(sggcd = %s AND umdnm LIKE %s)")
                        villa_params.extend([sgg_code, f'{umd_name}%'])

                if sgg_umd_conditions:
                    villa_query += f" AND ({' OR '.join(sgg_umd_conditions)})"
            elif sgg_codes and len(sgg_codes) > 0:
                # 여러 시군구 선택 시
                placeholders = ','.join(['%s'] * len(sgg_codes))
                villa_query += f" AND sggcd IN ({placeholders})"
                villa_params.extend(sgg_codes)
            elif sido_code:
                # 시도만 선택했을 때 - 해당 시도의 모든 시군구 포함
                sido_sgg_codes = [code for code, data in REGIONS['sigungu'].items() if data['sido_code'] == sido_code]
                if sido_sgg_codes:
                    placeholders = ','.join(['%s'] * len(sido_sgg_codes))
                    villa_query += f" AND sggcd IN ({placeholders})"
                    villa_params.extend(sido_sgg_codes)

            # 보증금 필터
            if deposit_min is not None:
                villa_query += " AND CAST(REPLACE(deposit, ',', '') AS INTEGER) >= %s"
                villa_params.append(deposit_min)
            if deposit_max is not None:
                villa_query += " AND CAST(REPLACE(deposit, ',', '') AS INTEGER) <= %s"
                villa_params.append(deposit_max)

            # 월세 필터
            if monthly_min is not None:
                villa_query += " AND CAST(REPLACE(monthlyrent, ',', '') AS INTEGER) >= %s"
                villa_params.append(monthly_min)
            if monthly_max is not None:
                villa_query += " AND CAST(REPLACE(monthlyrent, ',', '') AS INTEGER) <= %s"
                villa_params.append(monthly_max)

            # 건축년도 필터
            if build_year_min is not None:
                villa_query += " AND CAST(buildyear AS INTEGER) >= %s"
                villa_params.append(build_year_min)
            if build_year_max is not None:
                villa_query += " AND CAST(buildyear AS INTEGER) <= %s"
                villa_params.append(build_year_max)

            villa_query += " ORDER BY 계약년월 DESC, 계약일 DESC LIMIT %s OFFSET %s"
            villa_params.extend([page_size, offset])

            cursor.execute(villa_query, villa_params)
            villa_results = cursor.fetchall()
            for result in villa_results:
                result['source_type'] = 'villa'
            all_results.extend(villa_results)

        # 단독다가구 조회
        if include_dagagu:
            dagagu_query = """
                SELECT
                    sggcd,
                    umdnm,
                    jibun,
                    NULL as aptnm,
                    계약면적,
                    계약년월,
                    계약일,
                    보증금,
                    월세금,
                    NULL as 층,
                    건축년도,
                    계약구분,
                    계약기간,
                    종전계약보증금,
                    종전계약월세,
                    갱신요구권사용
                FROM dagagu_rent_transactions
                WHERE 1=1
            """
            dagagu_params = []

            # 계약만기시기 필터 (단독다가구는 YYYYMM 형식 사용)
            if contract_end:
                if len(contract_end) == 6:  # YYYYMM 형식
                    # 단독다가구는 YYYYMM 형식을 그대로 사용
                    dagagu_query += " AND 계약기간 LIKE %s"
                    dagagu_params.append(f'%{contract_end}%')
                else:
                    dagagu_query += " AND 계약기간 LIKE %s"
                    dagagu_params.append(f'%{contract_end}%')

            # 지역 필터
            if umd_codes and len(umd_codes) > 0:
                # 읍면동 선택 시 - 선택된 읍면동들의 시군구와 읍면동 패턴으로 필터링
                sgg_umd_conditions = []
                for umd_code in umd_codes:
                    umd_data = REGIONS['umd'].get(umd_code, {})
                    sgg_code = umd_data.get('sgg_code', '')
                    umd_name = umd_data.get('umd_name', '')
                    if sgg_code and umd_name:
                        # LIKE 패턴으로 해당 읍면동의 모든 리를 포함
                        sgg_umd_conditions.append(f"(sggcd = %s AND umdnm LIKE %s)")
                        dagagu_params.extend([sgg_code, f'{umd_name}%'])

                if sgg_umd_conditions:
                    dagagu_query += f" AND ({' OR '.join(sgg_umd_conditions)})"
            elif sgg_codes and len(sgg_codes) > 0:
                # 여러 시군구 선택 시
                placeholders = ','.join(['%s'] * len(sgg_codes))
                dagagu_query += f" AND sggcd IN ({placeholders})"
                dagagu_params.extend(sgg_codes)
            elif sido_code:
                # 시도만 선택했을 때 - 해당 시도의 모든 시군구 포함
                sido_sgg_codes = [code for code, data in REGIONS['sigungu'].items() if data['sido_code'] == sido_code]
                if sido_sgg_codes:
                    placeholders = ','.join(['%s'] * len(sido_sgg_codes))
                    dagagu_query += f" AND sggcd IN ({placeholders})"
                    dagagu_params.extend(sido_sgg_codes)

            # 보증금 필터
            if deposit_min is not None:
                dagagu_query += " AND CAST(REPLACE(보증금, ',', '') AS INTEGER) >= %s"
                dagagu_params.append(deposit_min)
            if deposit_max is not None:
                dagagu_query += " AND CAST(REPLACE(보증금, ',', '') AS INTEGER) <= %s"
                dagagu_params.append(deposit_max)

            # 월세 필터
            if monthly_min is not None:
                dagagu_query += " AND CAST(REPLACE(월세금, ',', '') AS INTEGER) >= %s"
                dagagu_params.append(monthly_min)
            if monthly_max is not None:
                dagagu_query += " AND CAST(REPLACE(월세금, ',', '') AS INTEGER) <= %s"
                dagagu_params.append(monthly_max)

            # 건축년도 필터
            if build_year_min is not None:
                dagagu_query += " AND CAST(건축년도 AS INTEGER) >= %s"
                dagagu_params.append(build_year_min)
            if build_year_max is not None:
                dagagu_query += " AND CAST(건축년도 AS INTEGER) <= %s"
                dagagu_params.append(build_year_max)

            dagagu_query += " ORDER BY 계약년월 DESC, 계약일 DESC LIMIT %s OFFSET %s"
            dagagu_params.extend([page_size, offset])

            print(f"=== 단독다가구 쿼리 디버깅 ===")
            print(f"dagagu_query: {dagagu_query}")
            print(f"dagagu_params: {dagagu_params}")

            cursor.execute(dagagu_query, dagagu_params)
            dagagu_results = cursor.fetchall()
            print(f"단독다가구 결과 개수: {len(dagagu_results)}")

            for result in dagagu_results:
                result['source_type'] = 'dagagu'
            all_results.extend(dagagu_results)

        # 오피스텔 조회
        if include_officetel:
            officetel_query = """
                SELECT
                    sggcd,
                    umdnm,
                    jibun,
                    offinm as aptnm,
                    excluusear as 계약면적,
                    dealyear || LPAD(dealmonth, 2, '0') as 계약년월,
                    dealday as 계약일,
                    deposit as 보증금,
                    monthlyrent as 월세금,
                    floor as 층,
                    buildyear as 건축년도,
                    contracttype as 계약구분,
                    contractterm as 계약기간,
                    predeposit as 종전계약보증금,
                    premonthlyrent as 종전계약월세,
                    userrright as 갱신요구권사용
                FROM officetel_rent_transactions
                WHERE 1=1
            """
            officetel_params = []

            # 계약만기시기 필터
            if contract_end:
                if len(contract_end) == 6:  # YYYYMM 형식
                    short_format = contract_end[2:4] + '.' + contract_end[4:6]  # 27.09
                    officetel_query += " AND contractterm LIKE %s"
                    officetel_params.append(f'%{short_format}')
                else:
                    officetel_query += " AND contractterm LIKE %s"
                    officetel_params.append(f'%{contract_end}')

            # 지역 필터 (단순한 IN 절 사용 - 빠름)
            if umd_codes and len(umd_codes) > 0:
                # 읍면동 선택 시 - 시군구 + 읍면동 조합으로 정확한 필터링
                sgg_umd_conditions = []
                for umd_code in umd_codes:
                    umd_data = REGIONS['umd'].get(umd_code, {})
                    sgg_code = umd_data.get('sgg_code', '')
                    umd_name = umd_data.get('umd_name', '')
                    if sgg_code and umd_name:
                        # LIKE 패턴으로 해당 읍면동의 모든 리를 포함
                        sgg_umd_conditions.append(f"(sggcd = %s AND umdnm LIKE %s)")
                        officetel_params.extend([sgg_code, f'{umd_name}%'])

                if sgg_umd_conditions:
                    officetel_query += f" AND ({' OR '.join(sgg_umd_conditions)})"
            elif sgg_codes and len(sgg_codes) > 0:
                # 여러 시군구 선택 시
                placeholders = ','.join(['%s'] * len(sgg_codes))
                officetel_query += f" AND sggcd IN ({placeholders})"
                officetel_params.extend(sgg_codes)
            elif sido_code:
                # 시도만 선택했을 때 - 해당 시도의 모든 시군구 포함
                sido_sgg_codes = [code for code, data in REGIONS['sigungu'].items() if data['sido_code'] == sido_code]
                if sido_sgg_codes:
                    placeholders = ','.join(['%s'] * len(sido_sgg_codes))
                    officetel_query += f" AND sggcd IN ({placeholders})"
                    officetel_params.extend(sido_sgg_codes)

            # 보증금 필터
            if deposit_min is not None:
                officetel_query += " AND CAST(REPLACE(deposit, ',', '') AS INTEGER) >= %s"
                officetel_params.append(deposit_min)
            if deposit_max is not None:
                officetel_query += " AND CAST(REPLACE(deposit, ',', '') AS INTEGER) <= %s"
                officetel_params.append(deposit_max)

            # 월세 필터
            if monthly_min is not None:
                officetel_query += " AND CAST(REPLACE(monthlyrent, ',', '') AS INTEGER) >= %s"
                officetel_params.append(monthly_min)
            if monthly_max is not None:
                officetel_query += " AND CAST(REPLACE(monthlyrent, ',', '') AS INTEGER) <= %s"
                officetel_params.append(monthly_max)

            # 건축년도 필터
            if build_year_min is not None:
                officetel_query += " AND CAST(buildyear AS INTEGER) >= %s"
                officetel_params.append(build_year_min)
            if build_year_max is not None:
                officetel_query += " AND CAST(buildyear AS INTEGER) <= %s"
                officetel_params.append(build_year_max)

            officetel_query += " ORDER BY 계약년월 DESC, 계약일 DESC LIMIT %s OFFSET %s"
            officetel_params.extend([page_size, offset])

            cursor.execute(officetel_query, officetel_params)
            officetel_results = cursor.fetchall()
            for result in officetel_results:
                result['source_type'] = 'officetel'
            all_results.extend(officetel_results)

        cursor.close()
        conn.close()

        # 지역명 추가 및 데이터 포맷팅
        for row in all_results:
            sggcd = row['sggcd']
            if sggcd in REGIONS['sigungu']:
                sido_full = REGIONS['sigungu'][sggcd]['sido']
                row['시도명'] = abbreviate_sido_name(sido_full)
                row['시군구명'] = REGIONS['sigungu'][sggcd]['name']

            # 읍면동리명 - DB의 umdnm이 이미 리까지 포함되어 있음
            row['읍면동리'] = row.get('umdnm', '')

            # 아파트의 경우 아파트명을 mhousename 필드에도 추가
            if 'aptnm' in row and row['aptnm']:
                row['mhousename'] = row['aptnm']

            # 보증금 포맷팅 (쉼표 제거 후 숫자로 변환, 억단위 처리)
            if '보증금' in row and row['보증금']:
                row['보증금'] = format_money(row['보증금'])

            # 월세금 포맷팅
            if '월세금' in row and row['월세금']:
                row['월세금'] = format_money(row['월세금'])

            # 종전계약보증금 포맷팅
            if '종전계약보증금' in row and row['종전계약보증금']:
                row['종전계약보증금'] = format_money(row['종전계약보증금'])

            # 종전계약월세 포맷팅
            if '종전계약월세' in row and row['종전계약월세']:
                row['종전계약월세'] = format_money(row['종전계약월세'])

        # 최신순 정렬
        all_results.sort(key=lambda x: (x.get('계약년월', ''), x.get('계약일', '')), reverse=True)



        return jsonify({
            'success': True,
            'data': all_results,
            'count': len(all_results),
            'page': page,
            'page_size': page_size,
            'has_more': len(all_results) == page_size * len([t for t in [include_apt, include_villa, include_dagagu, include_officetel] if t])
        })

    except Exception as e:
        print(f"조회 오류: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'조회 중 오류가 발생했습니다: {str(e)}'
        })



@app.route('/api/building/<building_name>', methods=['GET'])
def get_building_transactions_old(building_name):
    """특정 건물의 모든 실거래가 조회"""
    try:
        sgg_code = request.args.get('sgg_code')
        umd_name = request.args.get('umd_name')

        if not sgg_code or not umd_name:
            return jsonify({
                'success': False,
                'error': '시군구 코드와 읍면동명이 필요합니다.'
            })

        all_results = []
        conn = get_db_connection()
        cursor = conn.cursor()

        # 아파트 조회
        apt_query = """
            SELECT
                sggcd,
                umdnm,
                jibun,
                aptnm,
                excluusear as 계약면적,
                dealyear || LPAD(dealmonth, 2, '0') as 계약년월,
                dealday as 계약일,
                deposit as 보증금,
                monthlyrent as 월세금,
                floor as 층,
                buildyear as 건축년도,
                contracttype as 계약구분,
                contractterm as 계약기간,
                predeposit as 종전계약보증금,
                premonthlyrent as 종전계약월세,
                userrright as 갱신요구권사용
            FROM apt_rent_transactions
            WHERE sggcd = %s AND umdnm = %s AND aptnm = %s
            ORDER BY 계약년월 DESC, 계약일 DESC
        """

        cursor.execute(apt_query, [sgg_code, umd_name, building_name])
        apt_results = cursor.fetchall()
        for result in apt_results:
            result['source_type'] = 'apt'
        all_results.extend(apt_results)

        # 연립다세대 조회
        villa_query = """
            SELECT
                sggcd,
                umdnm,
                jibun,
                mhousename as aptnm,
                excluusear as 계약면적,
                dealyear || LPAD(dealmonth, 2, '0') as 계약년월,
                dealday as 계약일,
                deposit as 보증금,
                monthlyrent as 월세금,
                floor as 층,
                buildyear as 건축년도,
                contracttype as 계약구분,
                contractterm as 계약기간,
                predeposit as 종전계약보증금,
                premonthlyrent as 종전계약월세,
                userrright as 갱신요구권사용
            FROM villa_rent_transactions
            WHERE sggcd = %s AND umdnm = %s AND mhousename = %s
            ORDER BY 계약년월 DESC, 계약일 DESC
        """

        cursor.execute(villa_query, [sgg_code, umd_name, building_name])
        villa_results = cursor.fetchall()
        for result in villa_results:
            result['source_type'] = 'villa'
        all_results.extend(villa_results)

        # 오피스텔 조회
        officetel_query = """
            SELECT
                sggcd,
                umdnm,
                jibun,
                offinm as aptnm,
                excluusear as 계약면적,
                dealyear || LPAD(dealmonth, 2, '0') as 계약년월,
                dealday as 계약일,
                deposit as 보증금,
                monthlyrent as 월세금,
                floor as 층,
                buildyear as 건축년도,
                contracttype as 계약구분,
                contractterm as 계약기간,
                predeposit as 종전계약보증금,
                premonthlyrent as 종전계약월세,
                userrright as 갱신요구권사용
            FROM officetel_rent_transactions
            WHERE sggcd = %s AND umdnm = %s AND offinm = %s
            ORDER BY 계약년월 DESC, 계약일 DESC
        """

        cursor.execute(officetel_query, [sgg_code, umd_name, building_name])
        officetel_results = cursor.fetchall()
        for result in officetel_results:
            result['source_type'] = 'officetel'
        all_results.extend(officetel_results)

        cursor.close()
        conn.close()

        # 지역명 추가 및 데이터 포맷팅
        for row in all_results:
            sggcd = row['sggcd']
            if sggcd in REGIONS['sigungu']:
                sido_full = REGIONS['sigungu'][sggcd]['sido']
                row['시도명'] = abbreviate_sido_name(sido_full)
                row['시군구명'] = REGIONS['sigungu'][sggcd]['name']

            row['읍면동리'] = row.get('umdnm', '')

            # 보증금 포맷팅
            if '보증금' in row and row['보증금']:
                row['보증금'] = format_money(row['보증금'])

            # 월세금 포맷팅
            if '월세금' in row and row['월세금']:
                row['월세금'] = format_money(row['월세금'])

            # 종전계약보증금 포맷팅
            if '종전계약보증금' in row and row['종전계약보증금']:
                row['종전계약보증금'] = format_money(row['종전계약보증금'])

            # 종전계약월세 포맷팅
            if '종전계약월세' in row and row['종전계약월세']:
                row['종전계약월세'] = format_money(row['종전계약월세'])

        # 최신순 정렬
        all_results.sort(key=lambda x: (x.get('계약년월', ''), x.get('계약일', '')), reverse=True)

        return jsonify({
            'success': True,
            'data': all_results,
            'count': len(all_results),
            'building_name': building_name
        })

    except Exception as e:
        print(f"건물 조회 오류: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'건물 조회 중 오류가 발생했습니다: {str(e)}'
        })


# 지역 API 엔드포인트들
@app.route('/api/locations/sido')
def api_sido():
    """시도 목록 API"""
    try:
        # lawd_code.csv에서 시도 목록 가져오기
        sidos = set()

        try:
            with open('./files/lawd_code.csv', 'r', encoding='utf-8-sig') as f:
                csv_reader = csv.DictReader(f)
                for row in csv_reader:
                    if row.get('시도명') and not row.get('삭제일자'):
                        sidos.add(row['시도명'])
        except FileNotFoundError:
            # 기본 시도 목록
            sidos = {'서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시',
                    '대전광역시', '울산광역시', '세종특별자치시', '경기도', '강원도',
                    '충청북도', '충청남도', '전라북도', '전라남도', '경상북도',
                    '경상남도', '제주특별자치도'}

        return jsonify({
            'success': True,
            'sidos': sorted(list(sidos))
        })

    except Exception as e:
        print(f"시도 목록 조회 오류: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'시도 목록 조회 중 오류가 발생했습니다: {str(e)}'
        })

@app.route('/api/locations/sigungu')
def api_sigungu():
    """시군구 목록 API"""
    try:
        sido = request.args.get('sido')
        print(f"[DEBUG] 요청된 시도: {sido}")

        if not sido:
            return jsonify({
                'success': False,
                'error': '시도가 선택되지 않았습니다.'
            })

        sigungus = set()
        row_count = 0

        try:
            with open('./files/lawd_code.csv', 'r', encoding='utf-8-sig') as f:
                csv_reader = csv.DictReader(f)
                for row in csv_reader:
                    row_count += 1
                    if row.get('시도명') == sido and row.get('시군구명') and not row.get('삭제일자'):
                        sigungus.add(row['시군구명'])

            print(f"[DEBUG] 읽은 행 수: {row_count}")
            print(f"[DEBUG] 찾은 시군구 수: {len(sigungus)}")
            print(f"[DEBUG] 시군구 목록: {list(sigungus)[:5]}")  # 처음 5개만
        except FileNotFoundError as e:
            print(f"[ERROR] 파일을 찾을 수 없음: {e}")
            # 기본 시군구 목록 (서울 예시)
            if sido == '서울특별시':
                sigungus = {'강남구', '강동구', '강북구', '강서구', '관악구', '광진구',
                          '구로구', '금천구', '노원구', '도봉구', '동대문구', '동작구',
                          '마포구', '서대문구', '서초구', '성동구', '성북구', '송파구',
                          '양천구', '영등포구', '용산구', '은평구', '종로구', '중구', '중랑구'}

        return jsonify({
            'success': True,
            'sigungus': sorted(list(sigungus))
        })

    except Exception as e:
        print(f"시군구 목록 조회 오류: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'시군구 목록 조회 중 오류가 발생했습니다: {str(e)}'
        })

@app.route('/api/locations/umd')
def api_umd():
    """읍면동 목록 API"""
    try:
        sido = request.args.get('sido')
        sigungus = request.args.getlist('sigungu')

        if not sido or not sigungus:
            return jsonify({
                'success': False,
                'error': '시도 또는 시군구가 선택되지 않았습니다.'
            })

        umds = {}

        try:
            with open('./files/lawd_code.csv', 'r', encoding='utf-8-sig') as f:
                csv_reader = csv.DictReader(f)
                for row in csv_reader:
                    if (row.get('시도명') == sido and
                        row.get('시군구명') in sigungus and
                        row.get('읍면동명') and
                        not row.get('삭제일자')):
                        sigungu = row['시군구명']
                        if sigungu not in umds:
                            umds[sigungu] = set()
                        umds[sigungu].add(row['읍면동명'])
        except FileNotFoundError as e:
            print(f"CSV 파일을 찾을 수 없습니다: {e}")
            return jsonify({
                'success': False,
                'error': 'CSV 파일을 찾을 수 없습니다.'
            })

        # set을 list로 변환하고 정렬
        result = {}
        for sigungu, umd_set in umds.items():
            result[sigungu] = sorted(list(umd_set))

        return jsonify({
            'success': True,
            'umds': result
        })

    except Exception as e:
        print(f"읍면동 목록 조회 오류: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'읍면동 목록 조회 중 오류가 발생했습니다: {str(e)}'
        })


def fetch_officetel_standard_prices_batch(cursor, sggcd, rows):
    """
    여러 행의 오피스텔 기준시가를 일괄 조회
    Returns: dict mapping (지번, 층, 면적) -> {'unit_price': ..., 'exclusive_area': ..., 'shared_area': ...}
    """
    print(f"[DEBUG 오피스텔일괄] 시작: {len(rows)}건, sggcd={sggcd}")

    if not rows:
        print("[DEBUG 오피스텔일괄] rows가 비어있음")
        return {}

    # 법정동코드 5자리 사용
    bjdcd_5 = sggcd
    print(f"[DEBUG 오피스텔일괄] 법정동코드 5자리: {bjdcd_5}")

    # 모든 row의 조건 수집
    conditions = []
    for idx, row in enumerate(rows):
        jibun = row.get('지번')
        floor = row.get('층')
        area = row.get('면적')

        if not all([jibun, floor is not None, area]):
            if idx < 3:  # 처음 3개만 로그
                print(f"[DEBUG 오피스텔일괄] 행{idx} 스킵 - 지번={jibun}, 층={floor}, 면적={area}")
            continue

        # 지번 파싱
        parts = jibun.split('-')
        bunji = parts[0].strip()
        ho = parts[1].strip() if len(parts) > 1 else '0'

        # 번지/호 검증 (숫자만 허용)
        if not bunji or not bunji.isdigit():
            if idx < 3:
                print(f"[DEBUG 오피스텔일괄] 행{idx} 번지 검증 실패 - 지번={jibun}, bunji={bunji}")
            continue
        if not ho or not ho.isdigit():
            if idx < 3:
                print(f"[DEBUG 오피스텔일괄] 행{idx} 호 검증 실패 - 지번={jibun}, ho={ho}")
            continue

        # 층 변환
        try:
            floor_int = int(floor)
        except Exception as e:
            if idx < 3:
                print(f"[DEBUG 오피스텔일괄] 행{idx} 층 변환 실패 - 층={floor}, 오류={e}")
            continue

        # 면적 변환
        try:
            area_float = round(float(area), 2)
        except Exception as e:
            if idx < 3:
                print(f"[DEBUG 오피스텔일괄] 행{idx} 면적 변환 실패 - 면적={area}, 오류={e}")
            continue

        conditions.append({
            '지번': jibun,
            '층': floor,
            '면적': area,
            'bunji': bunji,
            'ho': ho,
            'floor_int': floor_int,
            'area_float': area_float
        })

        # 처음 3개 조건만 로그 출력
        if idx < 3:
            print(f"[DEBUG 오피스텔일괄] 조건{idx}: 지번={jibun}, bunji={bunji}, ho={ho}, floor_int={floor_int}, area={area_float}")

    if not conditions:
        print("[DEBUG 오피스텔일괄] 조건이 하나도 없음")
        return {}

    print(f"[DEBUG 오피스텔일괄] 총 {len(conditions)}개 조건 생성")

    # WHERE 절 생성 (OR로 연결)
    where_parts = []
    params = [bjdcd_5]

    for cond in conditions:
        # 층 구분 조건 (파라미터는 나중에 추가)
        if cond['floor_int'] < 0:
            # 지하층
            floor_condition = '("건물층구분코드" = \'지하층\' AND "상가건물층주소" ~ \'^[0-9]+$\' AND "상가건물층주소"::INTEGER = %s)'
            floor_param = abs(cond['floor_int'])
        else:
            # 지상층
            floor_condition = '("건물층구분코드" = \'지상층\' AND "상가건물층주소" ~ \'^[0-9]+$\' AND "상가건물층주소"::INTEGER = %s)'
            floor_param = cond['floor_int']

        where_parts.append(
            f'("번지" ~ \'^[0-9]+$\' AND "번지"::INTEGER = %s AND "호" ~ \'^[0-9]+$\' AND "호"::INTEGER = %s AND {floor_condition} AND "전용면적"::FLOAT = %s)'
        )
        # WHERE 절의 순서대로 파라미터 추가: 번지(int), 호(int), 층(int), 면적(float)
        params.extend([int(cond['bunji']), int(cond['ho']), floor_param, cond['area_float']])

    query = f"""
        SELECT DISTINCT
            "번지", "호", "상가건물층주소", "건물층구분코드", "전용면적"::FLOAT as 전용면적,
            "공유면적"::FLOAT as 공유면적, "고시가격"::FLOAT as 고시가격
        FROM officetel_standard_price
        WHERE LEFT("법정동코드", 5) = %s
          AND ({' OR '.join(where_parts)})
    """

    print(f"[DEBUG 오피스텔일괄] 쿼리 실행: {len(conditions)}개 조건")
    print(f"[DEBUG 오피스텔일괄] 법정동코드 파라미터: {params[0]}")
    print(f"[DEBUG 오피스텔일괄] 첫 3개 조건 파라미터 샘플: {params[1:min(13, len(params))]}")  # 첫 3개 조건 = 12개 파라미터

    # 실제 쿼리 출력 (첫 1000자만)
    try:
        formatted_query = query % tuple(f"'{p}'" if isinstance(p, str) else str(p) for p in params)
        print(f"[DEBUG 오피스텔일괄] 실제 쿼리 샘플:\n{formatted_query[:1000]}")
    except:
        pass

    cursor.execute(query, params)
    db_results = cursor.fetchall()
    print(f"[DEBUG 오피스텔일괄] DB 결과: {len(db_results)}건")

    if len(db_results) > 0:
        print(f"[DEBUG 오피스텔일괄] DB 샘플 결과: 번지={db_results[0]['번지']}, 호={db_results[0]['호']}, 층구분={db_results[0]['건물층구분코드']}, 층주소={db_results[0]['상가건물층주소']}, 전용면적={db_results[0]['전용면적']}")
    else:
        # 0건인 경우 디버깅: 해당 법정동코드에 데이터가 있는지 확인
        test_query = """
            SELECT COUNT(*) as cnt,
                   MIN("번지") as min_bunji, MAX("번지") as max_bunji,
                   MIN("호") as min_ho, MAX("호") as max_ho
            FROM officetel_standard_price
            WHERE LEFT("법정동코드", 5) = %s
        """
        cursor.execute(test_query, [bjdcd_5])
        test_result = cursor.fetchone()
        print(f"[DEBUG 오피스텔일괄] 해당 법정동코드({bjdcd_5}) 총 데이터: {test_result['cnt']}건, 번지범위: {test_result['min_bunji']}~{test_result['max_bunji']}, 호범위: {test_result['min_ho']}~{test_result['max_ho']}")

        # 첫 번째 조건으로 샘플 검색
        if conditions:
            first_cond = conditions[0]
            sample_query = """
                SELECT "번지", "호", "건물층구분코드", "상가건물층주소", "전용면적"::FLOAT as 전용면적
                FROM officetel_standard_price
                WHERE LEFT("법정동코드", 5) = %s
                  AND "번지" = %s
                LIMIT 5
            """
            cursor.execute(sample_query, [bjdcd_5, first_cond['bunji']])
            samples = cursor.fetchall()
            print(f"[DEBUG 오피스텔일괄] 첫 조건 번지({first_cond['bunji']}) 샘플: {len(samples)}건")
            for s in samples[:3]:
                print(f"  - 번지={s['번지']}(타입:{type(s['번지']).__name__}), 호={s['호']}(타입:{type(s['호']).__name__}), 층={s['상가건물층주소']}(타입:{type(s['상가건물층주소']).__name__}), 면적={s['전용면적']}")

    # 결과를 딕셔너리로 매핑
    price_map = {}
    for db_row in db_results:
        # 원래 지번 형태로 복원 (0-padding 제거를 위해 int 변환 후 다시 str)
        bunji = str(int(db_row['번지']))
        ho = str(int(db_row['호']))
        jibun_key = bunji if ho == '0' else f"{bunji}-{ho}"

        # 층 복원
        floor_code = db_row['건물층구분코드']
        floor_num = int(db_row['상가건물층주소'])
        floor_key = -floor_num if floor_code == '지하층' else floor_num

        # 면적
        area_key = round(float(db_row['전용면적']), 2)

        key = (jibun_key, floor_key, area_key)

        if key not in price_map:
            price_map[key] = []

        try:
            unit_price = float(db_row['고시가격'])
            exclusive_area = float(db_row['전용면적'])
            shared_area = float(db_row['공유면적'])
            price_map[key].append({
                'unit_price': unit_price,
                'exclusive_area': exclusive_area,
                'shared_area': shared_area
            })
        except:
            continue

    # 평균 계산 및 결과 맵 생성
    result_map = {}
    for key, prices in price_map.items():
        if prices:
            # 첫 번째 값 사용 (DISTINCT로 중복 제거되어 있음)
            data = prices[0]
            total_area = data['exclusive_area'] + data['shared_area']
            standard_price = data['unit_price'] * total_area
            threshold_126 = standard_price * 1.26

            result_map[key] = {
                'unit_price': data['unit_price'],
                'exclusive_area': data['exclusive_area'],
                'shared_area': data['shared_area'],
                'total_area': total_area,
                'standard_price': int(standard_price),
                'threshold_126': int(threshold_126)
            }

    print(f"[DEBUG 오피스텔일괄] 매핑 완료: {len(result_map)}건")
    if result_map:
        sample_key = list(result_map.keys())[0]
        print(f"[DEBUG 오피스텔일괄] 샘플 키: {sample_key}")

    return result_map


def fetch_apartment_prices_batch(cursor, sggcd, umdnm, rows):
    """
    여러 행의 공동주택가격을 일괄 조회 (N+1 쿼리 문제 해결)
    Returns: dict mapping (지번, 층, 면적) -> {'price': ..., 'threshold_126': ...}
    """
    print(f"[DEBUG 일괄조회] 시작: {len(rows)}건, sggcd={sggcd}, umdnm={umdnm}")

    if not rows:
        print("[DEBUG 일괄조회] rows가 비어있음")
        return {}

    # 법정동코드 10자리 찾기
    bjdcd_10 = None
    for code, info in REGIONS['umd'].items():
        if info['sgg_code'] == sggcd and info['umd_name'] == umdnm:
            bjdcd_10 = code
            break

    if not bjdcd_10:
        print(f"[DEBUG 일괄조회] 법정동코드 찾기 실패")
        return {}

    # 모든 row의 조건 수집
    conditions = []
    for row in rows:
        jibun = row.get('지번')
        floor = row.get('층')
        excluusear = row.get('면적')

        if not all([jibun, floor is not None, excluusear]):
            continue

        # 지번 파싱
        parts = jibun.split('-')
        bon = parts[0].strip()
        bu = parts[1].strip() if len(parts) > 1 else '0'

        # 층 변환
        try:
            floor_int = int(floor)
            floor_str = str(floor_int)
        except:
            continue

        # 면적 변환
        try:
            area_float = round(float(excluusear), 2)
        except:
            continue

        conditions.append({
            '지번': jibun,
            '층': floor,
            '면적': excluusear,
            'bon': bon,
            'bu': bu,
            'floor_str': floor_str,
            'area_float': area_float
        })

    if not conditions:
        return {}

    # WHERE 절 생성 (OR로 연결)
    where_parts = []
    params = [bjdcd_10]

    for cond in conditions:
        where_parts.append(
            '("본번" = %s AND "부번" = %s AND "층번호" = %s AND "공동주택전유면적"::FLOAT = %s)'
        )
        params.extend([cond['bon'], cond['bu'], cond['floor_str'], cond['area_float']])

    query = f"""
        SELECT DISTINCT
            "본번", "부번", "층번호", "공동주택전유면적"::FLOAT as 면적, "공시가격"
        FROM bldg_apartment_price
        WHERE "법정동코드" = %s
          AND ({' OR '.join(where_parts)})
    """

    print(f"[DEBUG 일괄조회] 쿼리 실행: {len(conditions)}개 조건")

    cursor.execute(query, params)
    db_results = cursor.fetchall()
    print(f"[DEBUG 일괄조회] DB 결과: {len(db_results)}건")

    # 결과를 딕셔너리로 매핑
    price_map = {}
    for db_row in db_results:
        # 원래 지번 형태로 복원 (공백 제거)
        bon = str(db_row['본번']).strip()
        bu = str(db_row['부번']).strip()
        jibun_key = bon if bu == '0' else f"{bon}-{bu}"
        floor_key = int(db_row['층번호'])
        # 면적을 2자리로 반올림 (쿼리 시와 동일하게)
        area_key = round(float(db_row['면적']), 2)

        key = (jibun_key, floor_key, area_key)

        if key not in price_map:
            price_map[key] = []

        try:
            price = float(db_row['공시가격'])
            price_map[key].append(price)
        except:
            continue

    # 평균 계산 및 126% 임계값
    result_map = {}
    for key, prices in price_map.items():
        if prices:
            avg_price = sum(prices) / len(prices)
            result_map[key] = {
                'price': int(avg_price),
                'threshold_126': int(avg_price * 1.26)
            }

    print(f"[DEBUG 일괄조회] 매핑 완료: {len(result_map)}건")
    if result_map:
        sample_key = list(result_map.keys())[0]
        print(f"[DEBUG 일괄조회] 샘플 키: {sample_key}")

    return result_map


def fetch_apartment_price_for_row(cursor, sggcd, umdnm, jibun, floor, excluusear, dong_no=None):
    """
    단일 행의 공동주택가격 정보를 조회하는 헬퍼 함수 (레거시, 호환성 유지)
    Returns: dict with 'price', 'threshold_126' keys or None
    """
    try:
        # 필수 파라미터 확인
        if not all([sggcd, umdnm, jibun, floor is not None, excluusear]):
            print(f"[DEBUG 공동주택] 필수 파라미터 누락: sggcd={sggcd}, umdnm={umdnm}, jibun={jibun}, floor={floor}, excluusear={excluusear}")
            return None

        # 법정동코드 10자리 찾기 (시군구코드 5자리 + 법정동코드 5자리)
        bjdcd_10 = None
        for code, info in REGIONS['umd'].items():
            if info['sgg_code'] == sggcd and info['umd_name'] == umdnm:
                bjdcd_10 = code  # 전체 10자리
                break

        if not bjdcd_10:
            print(f"[DEBUG 공동주택] 법정동코드 찾기 실패: sggcd={sggcd}, umdnm={umdnm}")
            return None

        # 지번 파싱: "17-3" → 본번 "17", 부번 "3" / "134" → 본번 "134", 부번 ""
        jibun_parts = str(jibun).strip().split('-')
        bon = jibun_parts[0].strip()
        bu = jibun_parts[1].strip() if len(jibun_parts) > 1 else ''

        # 층 번호 처리
        try:
            floor_str = str(int(float(floor)))
        except (ValueError, TypeError):
            print(f"[DEBUG 공동주택] 층 번호 변환 실패: floor={floor}")
            return None

        # 면적 처리
        try:
            area_float = float(excluusear)
        except (ValueError, TypeError):
            print(f"[DEBUG 공동주택] 면적 변환 실패: excluusear={excluusear}")
            return None

        # DB 쿼리: 법정동코드, 본번, 부번, 층번호, 공동주택전유면적으로 매칭
        # 성능 최적화: TRIM 제거 (데이터에 공백 없음, 인덱스 완전 활용)
        query = """
        SELECT DISTINCT "공시가격"
        FROM bldg_apartment_price
        WHERE "법정동코드" = %s
          AND "본번" = %s
          AND "부번" = %s
          AND "층번호" = %s
          AND "공동주택전유면적"::FLOAT = %s
        """

        print(f"[DEBUG 공동주택] 쿼리 실행: bjdcd={bjdcd_10}, 본번={bon}, 부번={bu}, 층={floor_str}, 면적={area_float}")
        cursor.execute(query, (bjdcd_10, bon, bu, floor_str, area_float))
        results = cursor.fetchall()
        print(f"[DEBUG 공동주택] 쿼리 결과: {len(results)}건")

        if not results:
            return None

        # 공시가격 값 추출 (dict 형태로 반환됨)
        prices = [float(r['공시가격']) for r in results if r['공시가격']]

        if not prices:
            print(f"[DEBUG 공동주택] 공시가격 값 없음")
            return None

        # 여러 행이 있지만 가격이 일치하지 않으면 None 반환
        if len(set(prices)) > 1:
            print(f"[DEBUG 공동주택] 여러 가격 존재: {prices}")
            return None

        # 가격이 일치하면 사용
        price = prices[0]
        threshold_126 = price * 1.26
        print(f"[DEBUG 공동주택] 성공! 가격={price:,.0f}원, 126%={threshold_126:,.0f}원")

        return {
            'price': price,
            'threshold_126': threshold_126
        }

    except Exception as e:
        print(f"[ERROR] 공동주택가격 조회 오류: {str(e)}")
        import traceback
        traceback.print_exc()
        return None


def fetch_unit_info_for_row(cursor, sggcd, umdnm, jibun, floor, excluusear):
    """
    단일 행의 호실 정보를 조회하는 헬퍼 함수
    Returns: dict with 'unit', 'all_units', 'has_more' keys
    """
    try:
        # 필수 파라미터 확인
        if not all([sggcd, umdnm, jibun, floor is not None, excluusear]):
            return {'unit': '-', 'all_units': [], 'has_more': False}

        # 법정동코드 5자리 찾기
        bjdcd = None
        for code, info in REGIONS['umd'].items():
            if info['sgg_code'] == sggcd and info['umd_name'] == umdnm:
                bjdcd = code[5:]  # 뒤 5자리가 법정동코드
                break

        if not bjdcd:
            return {'unit': '-', 'all_units': [], 'has_more': False}

        # 지번 파싱
        jibun_parts = str(jibun).split('-')
        bon = jibun_parts[0].strip().zfill(4)
        bu = jibun_parts[1].strip().zfill(4) if len(jibun_parts) > 1 else '0000'

        # 층 처리
        try:
            floor_int = int(float(floor))
        except (ValueError, TypeError):
            return {'unit': '-', 'all_units': [], 'has_more': False}

        if floor_int < 0:
            floor_code = '10'  # 지하
            floor_num = str(abs(floor_int))
        else:
            floor_code = '20'  # 지상
            floor_num = str(floor_int)

        # 면적 처리
        try:
            area = str(float(excluusear))
        except (ValueError, TypeError):
            return {'unit': '-', 'all_units': [], 'has_more': False}

        # DB 쿼리
        query = """
        SELECT DISTINCT "동_명", "호_명"
        FROM bldg_exclusive_area
        WHERE "전유_공용_구분_코드" = '1'
          AND "시군구_코드" = %s
          AND "법정동_코드" = %s
          AND "번" = %s
          AND "지" = %s
          AND "층_구분_코드" = %s
          AND "층_번호" = %s
          AND "면적(㎡)" = %s
        LIMIT 100
        """

        cursor.execute(query, (sggcd, bjdcd, bon, bu, floor_code, floor_num, area))
        results = cursor.fetchall()

        # 결과 처리
        if not results:
            return {'unit': '-', 'all_units': [], 'has_more': False}

        # 모든 고유한 동명+호명 조합 수집
        unique_units = set()
        for r in results:
            dong = (r.get('동_명', '').strip() if r.get('동_명') else '')
            ho = (r.get('호_명', '').strip() if r.get('호_명') else '')
            if dong and ho:
                unique_units.add(f"{dong} {ho}")
            elif ho:  # 동명 없이 호명만 있는 경우
                unique_units.add(ho)

        if not unique_units:
            return {'unit': '-', 'all_units': [], 'has_more': False}

        # 전체 목록 (정렬)
        all_unit_list = sorted(list(unique_units))

        # 표시용: 최대 10개까지만
        display_list = all_unit_list[:10]
        unit_str = ', '.join(display_list)

        if len(unique_units) > 10:
            unit_str += f" 외 {len(unique_units) - 10}개"

        return {
            'unit': unit_str,
            'all_units': all_unit_list,
            'has_more': len(unique_units) > 10
        }

    except Exception as e:
        print(f"[ERROR] 호실 조회 오류: {str(e)}")
        return {'unit': '-', 'all_units': [], 'has_more': False}


@app.route('/api/search', methods=['POST'])
def api_search():
    """실거래가 검색 API (이름 기반)"""
    try:
        # JSON 파싱 시 인코딩 에러 처리
        try:
            filters = request.get_json(force=True)
        except:
            # 인코딩 에러 시 request.data를 직접 디코딩
            import json
            filters = json.loads(request.data.decode('utf-8', errors='ignore'))
        print(f"[DEBUG] 받은 필터: {filters}")

        # 필터 파라미터
        include_apt = filters.get('include_apt', True)
        include_villa = filters.get('include_villa', True)
        include_dagagu = filters.get('include_dagagu', True)
        include_officetel = filters.get('include_officetel', True)
        contract_end = filters.get('contract_end', '').strip()
        sido_name = filters.get('sido')
        sigungu_names = filters.get('sigungu', [])
        umd_names = filters.get('umd', [])

        # 숫자 필터 파라미터 - 검증 및 변환
        def parse_numeric_filter(value, data_type=float):
            """숫자 필터를 안전하게 파싱"""
            if value is None:
                return None
            if isinstance(value, (int, float)):
                return data_type(value)
            if isinstance(value, str):
                value = value.strip()
                if not value:
                    return None
                try:
                    return data_type(value)
                except (ValueError, TypeError):
                    return None
            return None

        area_min = parse_numeric_filter(filters.get('area_min'), float)
        area_max = parse_numeric_filter(filters.get('area_max'), float)
        deposit_min = parse_numeric_filter(filters.get('deposit_min'), int)
        deposit_max = parse_numeric_filter(filters.get('deposit_max'), int)
        rent_min = parse_numeric_filter(filters.get('rent_min'), int)
        rent_max = parse_numeric_filter(filters.get('rent_max'), int)
        build_year_min = parse_numeric_filter(filters.get('build_year_min'), int)
        build_year_max = parse_numeric_filter(filters.get('build_year_max'), int)

        page = filters.get('page', 1)
        page_size = filters.get('page_size', 10)  # 성능 최적화: 20 → 10
        offset = (page - 1) * page_size

        # 필수값 검증: 계약만기시기 및 시군구
        if not contract_end:
            return jsonify({
                'success': False,
                'error': '계약만기시기를 선택해주세요.'
            })

        if not (sigungu_names and len(sigungu_names) > 0):
            return jsonify({
                'success': False,
                'error': '최소 1개 이상의 시군구를 선택해주세요.'
            })

        all_results = []
        result_counts = []  # 각 주택 유형별 조회 건수 추적
        conn = get_db_connection()
        cursor = conn.cursor()

        # 시군구 이름을 코드로 변환 (모든 주택 유형에서 공통 사용)
        # 시도와 시군구를 함께 확인하여 정확한 지역만 선택
        sgg_codes = []
        if sigungu_names and len(sigungu_names) > 0:
            for name in sigungu_names:
                for code, data in REGIONS['sigungu'].items():
                    # 시도와 시군구 이름이 모두 일치하는 경우만 선택
                    if data['name'] == name and (sido_name is None or data['sido'] == sido_name):
                        sgg_codes.append(code)

        # 아파트 조회
        if include_apt:
            import time
            start_time = time.time()
            print(f"[DEBUG] ========== 아파트 조회 시작 ==========")
            print(f"[DEBUG] 계약만기시기: {contract_end}")
            print(f"[DEBUG] 시군구 코드: {sgg_codes}")
            print(f"[DEBUG] 읍면동: {umd_names}")

            query = """
                SELECT
                    '아파트' as 구분,
                    sggcd as 시군구코드,
                    umdnm as 읍면동리,
                    jibun as 지번,
                    aptnm as 단지명,
                    excluusear as 면적,
                    dealyear || LPAD(dealmonth::text, 2, '0') as 계약년월,
                    dealday as 계약일,
                    deposit as 보증금,
                    monthlyrent as 월세,
                    floor as 층,
                    buildyear as 건축년도,
                    contracttype as 계약구분,
                    contractterm as 계약기간,
                    predeposit as 종전계약보증금,
                    premonthlyrent as 종전계약월세,
                    userrright as 갱신요구권사용
                FROM apt_rent_transactions
                WHERE 1=1
            """
            params = []

            # 1. 지역 필터를 먼저 적용 (인덱스 활용, 성능 최적화)
            if sgg_codes:
                placeholders = ','.join(['%s'] * len(sgg_codes))
                query += f" AND sggcd IN ({placeholders})"
                params.extend(sgg_codes)

            # 2. 읍면동 필터 추가
            if umd_names and len(umd_names) > 0:
                placeholders = ','.join(['%s'] * len(umd_names))
                query += f" AND umdnm IN ({placeholders})"
                params.extend(umd_names)

            # 3. 계약만기시기 필터 (SPLIT_PART 사용)
            if contract_end:
                if len(contract_end) == 6:  # YYYYMM 형식
                    short_format = contract_end[2:4] + '.' + contract_end[4:6]  # 202512 -> 25.12
                    query += " AND SPLIT_PART(contractterm, '~', 2) = %s"
                    params.append(short_format)
                else:
                    query += " AND SPLIT_PART(contractterm, '~', 2) = %s"
                    params.append(contract_end)

            # 4. 면적 필터
            if area_min:
                query += " AND CAST(excluusear AS FLOAT) >= %s"
                params.append(area_min)
            if area_max:
                query += " AND CAST(excluusear AS FLOAT) <= %s"
                params.append(area_max)

            # 5. 보증금 필터
            if deposit_min:
                query += " AND CAST(REPLACE(deposit, ',', '') AS INTEGER) >= %s"
                params.append(deposit_min)
            if deposit_max:
                query += " AND CAST(REPLACE(deposit, ',', '') AS INTEGER) <= %s"
                params.append(deposit_max)

            # 6. 월세 필터
            if rent_min:
                query += " AND CAST(REPLACE(monthlyrent, ',', '') AS INTEGER) >= %s"
                params.append(rent_min)
            if rent_max:
                query += " AND CAST(REPLACE(monthlyrent, ',', '') AS INTEGER) <= %s"
                params.append(rent_max)

            # 7. 건축년도 필터
            if build_year_min:
                query += " AND CAST(buildyear AS INTEGER) >= %s"
                params.append(build_year_min)
            if build_year_max:
                query += " AND CAST(buildyear AS INTEGER) <= %s"
                params.append(build_year_max)

            query += " ORDER BY 계약년월 DESC, 계약일 DESC LIMIT %s OFFSET %s"
            params.extend([page_size, offset])

            print(f"[DEBUG] 쿼리 실행 중...")
            print(f"[DEBUG] 파라미터 개수: {len(params)}")
            query_start = time.time()
            cursor.execute(query, params)
            query_end = time.time()
            print(f"[DEBUG] 쿼리 실행 완료: {query_end - query_start:.2f}초")

            results = cursor.fetchall()
            print(f"[DEBUG] 아파트 결과: {len(results)}건")
            result_counts.append(len(results))  # 건수 추적

            # 시도/시군구명 추가
            for row in results:
                sgg_code = row.get('시군구코드')
                if sgg_code and sgg_code in REGIONS['sigungu']:
                    sido_full = REGIONS['sigungu'][sgg_code]['sido']
                    row['시도'] = SIDO_ABBR.get(sido_full, sido_full)  # 축약형 사용
                    row['시군구'] = REGIONS['sigungu'][sgg_code]['name']
                else:
                    row['시도'] = ''
                    row['시군구'] = ''

            # 공동주택가격 일괄 조회 (N+1 쿼리 문제 해결)
            # 시군구별로 그룹화하여 일괄 조회
            from collections import defaultdict
            sgg_groups = defaultdict(lambda: defaultdict(list))
            for row in results:
                sgg_code = row.get('시군구코드')
                umd_name = row.get('읍면동리')
                if sgg_code and umd_name:
                    sgg_groups[sgg_code][umd_name].append(row)

            # 각 그룹별로 일괄 조회
            for sgg_code, umd_dict in sgg_groups.items():
                for umd_name, rows in umd_dict.items():
                    price_map = fetch_apartment_prices_batch(cursor, sgg_code, umd_name, rows)

                    # 결과 매핑
                    for row in rows:
                        jibun = row.get('지번')
                        floor = row.get('층')
                        area = row.get('면적')

                        if jibun and floor is not None and area:
                            try:
                                # 면적을 2자리로 반올림하여 키 생성 (batch 함수와 동일하게)
                                area_rounded = round(float(area), 2)
                                key = (jibun, int(floor), area_rounded)
                                if key in price_map:
                                    row['공동주택가격'] = price_map[key]['price']
                                    row['공동주택가격_126퍼센트'] = price_map[key]['threshold_126']
                            except:
                                pass

            # 호실 정보 조회 (아파트)
            for row in results:
                unit_info = fetch_unit_info_for_row(
                    cursor,
                    row.get('시군구코드'),
                    row.get('읍면동리'),
                    row.get('지번'),
                    row.get('층'),
                    row.get('면적')
                )
                row['동호명'] = unit_info['unit']
                row['동호명_전체목록'] = unit_info['all_units']
                row['동호명_더보기'] = unit_info['has_more']

            all_results.extend(results)
            total_time = time.time() - start_time
            print(f"[DEBUG] 아파트 조회 총 소요시간: {total_time:.2f}초")

        # 연립다세대 조회
        if include_villa:
            query = """
                SELECT
                    '연립다세대' as 구분,
                    sggcd as 시군구코드,
                    umdnm as 읍면동리,
                    jibun as 지번,
                    mhousename as 단지명,
                    excluusear as 면적,
                    dealyear || LPAD(dealmonth::text, 2, '0') as 계약년월,
                    dealday as 계약일,
                    deposit as 보증금,
                    monthlyrent as 월세,
                    floor as 층,
                    buildyear as 건축년도,
                    contracttype as 계약구분,
                    contractterm as 계약기간,
                    predeposit as 종전계약보증금,
                    premonthlyrent as 종전계약월세,
                    userrright as 갱신요구권사용
                FROM villa_rent_transactions
                WHERE 1=1
            """
            params = []

            # 1. 지역 필터를 먼저 적용 (인덱스 활용)
            if sgg_codes:
                placeholders = ','.join(['%s'] * len(sgg_codes))
                query += f" AND sggcd IN ({placeholders})"
                params.extend(sgg_codes)

            # 2. 읍면동 필터 추가
            if umd_names and len(umd_names) > 0:
                placeholders = ','.join(['%s'] * len(umd_names))
                query += f" AND umdnm IN ({placeholders})"
                params.extend(umd_names)

            # 3. 계약만기시기 필터
            if contract_end:
                if len(contract_end) == 6:  # YYYYMM 형식
                    short_format = contract_end[2:4] + '.' + contract_end[4:6]  # 202508 -> 25.08
                    query += " AND SPLIT_PART(contractterm, '~', 2) = %s"
                    params.append(short_format)
                else:
                    query += " AND SPLIT_PART(contractterm, '~', 2) = %s"
                    params.append(contract_end)

            if area_min:
                query += " AND CAST(excluusear AS FLOAT) >= %s"
                params.append(area_min)
            if area_max:
                query += " AND CAST(excluusear AS FLOAT) <= %s"
                params.append(area_max)

            if deposit_min:
                query += " AND CAST(REPLACE(deposit, ',', '') AS INTEGER) >= %s"
                params.append(deposit_min)
            if deposit_max:
                query += " AND CAST(REPLACE(deposit, ',', '') AS INTEGER) <= %s"
                params.append(deposit_max)

            if rent_min:
                query += " AND CAST(REPLACE(monthlyrent, ',', '') AS INTEGER) >= %s"
                params.append(rent_min)
            if rent_max:
                query += " AND CAST(REPLACE(monthlyrent, ',', '') AS INTEGER) <= %s"
                params.append(rent_max)

            if build_year_min:
                query += " AND CAST(buildyear AS INTEGER) >= %s"
                params.append(build_year_min)
            if build_year_max:
                query += " AND CAST(buildyear AS INTEGER) <= %s"
                params.append(build_year_max)

            query += " ORDER BY 계약년월 DESC, 계약일 DESC LIMIT %s OFFSET %s"
            params.extend([page_size, offset])

            cursor.execute(query, params)
            results = cursor.fetchall()
            result_counts.append(len(results))  # 건수 추적

            # 시도/시군구명 추가
            for row in results:
                sgg_code = row.get('시군구코드')
                if sgg_code and sgg_code in REGIONS['sigungu']:
                    sido_full = REGIONS['sigungu'][sgg_code]['sido']
                    row['시도'] = SIDO_ABBR.get(sido_full, sido_full)  # 축약형 사용
                    row['시군구'] = REGIONS['sigungu'][sgg_code]['name']
                else:
                    row['시도'] = ''
                    row['시군구'] = ''

            # 공동주택가격 일괄 조회 (N+1 쿼리 문제 해결)
            from collections import defaultdict
            sgg_groups = defaultdict(lambda: defaultdict(list))
            for row in results:
                sgg_code = row.get('시군구코드')
                umd_name = row.get('읍면동리')
                if sgg_code and umd_name:
                    sgg_groups[sgg_code][umd_name].append(row)

            # 각 그룹별로 일괄 조회
            for sgg_code, umd_dict in sgg_groups.items():
                for umd_name, rows in umd_dict.items():
                    price_map = fetch_apartment_prices_batch(cursor, sgg_code, umd_name, rows)

                    # 결과 매핑
                    for row in rows:
                        jibun = row.get('지번')
                        floor = row.get('층')
                        area = row.get('면적')

                        if jibun and floor is not None and area:
                            try:
                                # 면적을 2자리로 반올림하여 키 생성 (batch 함수와 동일하게)
                                area_rounded = round(float(area), 2)
                                key = (jibun, int(floor), area_rounded)
                                if key in price_map:
                                    row['공동주택가격'] = price_map[key]['price']
                                    row['공동주택가격_126퍼센트'] = price_map[key]['threshold_126']
                            except:
                                pass

            # 호실 정보 조회 (연립다세대)
            for row in results:
                unit_info = fetch_unit_info_for_row(
                    cursor,
                    row.get('시군구코드'),
                    row.get('읍면동리'),
                    row.get('지번'),
                    row.get('층'),
                    row.get('면적')
                )
                row['동호명'] = unit_info['unit']
                row['동호명_전체목록'] = unit_info['all_units']
                row['동호명_더보기'] = unit_info['has_more']

            all_results.extend(results)

        # 오피스텔 조회
        if include_officetel:
            query = """
                SELECT
                    '오피스텔' as 구분,
                    sggcd as 시군구코드,
                    umdnm as 읍면동리,
                    jibun as 지번,
                    offinm as 단지명,
                    excluusear as 면적,
                    dealyear || LPAD(dealmonth::text, 2, '0') as 계약년월,
                    dealday as 계약일,
                    deposit as 보증금,
                    monthlyrent as 월세,
                    floor as 층,
                    buildyear as 건축년도,
                    contracttype as 계약구분,
                    contractterm as 계약기간,
                    predeposit as 종전계약보증금,
                    premonthlyrent as 종전계약월세,
                    userrright as 갱신요구권사용
                FROM officetel_rent_transactions
                WHERE 1=1
            """
            params = []

            # 1. 지역 필터를 먼저 적용 (인덱스 활용)
            if sgg_codes:
                placeholders = ','.join(['%s'] * len(sgg_codes))
                query += f" AND sggcd IN ({placeholders})"
                params.extend(sgg_codes)

            # 2. 읍면동 필터 추가
            if umd_names and len(umd_names) > 0:
                placeholders = ','.join(['%s'] * len(umd_names))
                query += f" AND umdnm IN ({placeholders})"
                params.extend(umd_names)

            # 3. 계약만기시기 필터
            if contract_end:
                if len(contract_end) == 6:  # YYYYMM 형식
                    short_format = contract_end[2:4] + '.' + contract_end[4:6]  # 202508 -> 25.08
                    query += " AND SPLIT_PART(contractterm, '~', 2) = %s"
                    params.append(short_format)
                else:
                    query += " AND SPLIT_PART(contractterm, '~', 2) = %s"
                    params.append(contract_end)

            if area_min:
                query += " AND CAST(excluusear AS FLOAT) >= %s"
                params.append(area_min)
            if area_max:
                query += " AND CAST(excluusear AS FLOAT) <= %s"
                params.append(area_max)

            if deposit_min:
                query += " AND CAST(REPLACE(deposit, ',', '') AS INTEGER) >= %s"
                params.append(deposit_min)
            if deposit_max:
                query += " AND CAST(REPLACE(deposit, ',', '') AS INTEGER) <= %s"
                params.append(deposit_max)

            if rent_min:
                query += " AND CAST(REPLACE(monthlyrent, ',', '') AS INTEGER) >= %s"
                params.append(rent_min)
            if rent_max:
                query += " AND CAST(REPLACE(monthlyrent, ',', '') AS INTEGER) <= %s"
                params.append(rent_max)

            if build_year_min:
                query += " AND CAST(buildyear AS INTEGER) >= %s"
                params.append(build_year_min)
            if build_year_max:
                query += " AND CAST(buildyear AS INTEGER) <= %s"
                params.append(build_year_max)

            query += " ORDER BY dealyear DESC, dealmonth DESC, dealday DESC LIMIT %s OFFSET %s"
            params.extend([page_size, offset])

            cursor.execute(query, params)
            results = cursor.fetchall()
            result_counts.append(len(results))  # 건수 추적

            # 시도/시군구명 추가
            for row in results:
                sgg_code = row.get('시군구코드')
                if sgg_code and sgg_code in REGIONS['sigungu']:
                    sido_full = REGIONS['sigungu'][sgg_code]['sido']
                    row['시도'] = SIDO_ABBR.get(sido_full, sido_full)
                    row['시군구'] = REGIONS['sigungu'][sgg_code]['name']
                else:
                    row['시도'] = ''
                    row['시군구'] = ''

            # 오피스텔 기준시가 일괄 조회
            # 시군구별로 그룹화
            from collections import defaultdict
            sgg_groups_off = defaultdict(list)
            for row in results:
                sgg_code = row.get('시군구코드')
                if sgg_code:
                    sgg_groups_off[sgg_code].append(row)

            # 각 시군구별로 일괄 조회
            for sgg_code, rows in sgg_groups_off.items():
                price_map = fetch_officetel_standard_prices_batch(cursor, sgg_code, rows)

                # 결과 매핑
                for row in rows:
                    jibun = row.get('지번')
                    floor = row.get('층')
                    area = row.get('면적')

                    if jibun and floor is not None and area:
                        try:
                            # 면적을 2자리로 반올림하여 키 생성
                            area_rounded = round(float(area), 2)
                            key = (jibun, int(floor), area_rounded)
                            if key in price_map:
                                data = price_map[key]
                                row['기준시가_면적당가격'] = data['unit_price']
                                row['기준시가_전용면적'] = data['exclusive_area']
                                row['기준시가_공유면적'] = data['shared_area']
                                row['기준시가_면적계'] = data['total_area']
                                row['기준시가_총액'] = data['standard_price']
                                row['기준시가_126퍼센트'] = data['threshold_126']
                        except:
                            pass

            # 호실 정보 조회 (오피스텔)
            for row in results:
                unit_info = fetch_unit_info_for_row(
                    cursor,
                    row.get('시군구코드'),
                    row.get('읍면동리'),
                    row.get('지번'),
                    row.get('층'),
                    row.get('면적')
                )
                row['동호명'] = unit_info['unit']
                row['동호명_전체목록'] = unit_info['all_units']
                row['동호명_더보기'] = unit_info['has_more']

            all_results.extend(results)

        # 단독다가구 조회 (컬럼명이 한글일 수 있음)
        if include_dagagu:
            try:
                # 먼저 테이블 구조를 확인
                cursor.execute("SELECT * FROM dagagu_rent_transactions LIMIT 0")
                col_names = [desc[0] for desc in cursor.description]

                # 컬럼명 매핑 (실제 테이블 구조에 맞춘 올바른 인덱스)
                # 8:전용면적, 10:계약년, 11:계약일, 12:보증금, 13:월세, 14:건축년도, 15:도로명
                # 16:계약기간, 17:계약구분, 18:갱신요구권사용, 19:종전계약보증금, 20:종전계약월세, 21:층정보(주택유형)
                query = f"""
                    SELECT
                        '단독다가구' as 구분,
                        sggcd as 시군구코드,
                        umdnm as 읍면동리,
                        jibun as 지번,
                        "{col_names[15]}" as 단지명,
                        '-' as 층,
                        "{col_names[8]}" as 면적,
                        "{col_names[12]}" as 보증금,
                        "{col_names[13]}" as 월세,
                        "{col_names[10]}" as 계약년월,
                        "{col_names[11]}" as 계약일,
                        CASE
                            WHEN "{col_names[14]}" IS NULL OR "{col_names[14]}" = '' THEN NULL
                            WHEN CAST("{col_names[14]}" AS TEXT) ~ '^[0-9]+\.?[0-9]*$' THEN
                                CASE
                                    WHEN CAST("{col_names[14]}" AS FLOAT) BETWEEN 1800 AND 2200 THEN CAST(CAST("{col_names[14]}" AS FLOAT) AS INTEGER)
                                    ELSE NULL
                                END
                            ELSE NULL
                        END as 건축년도,
                        "{col_names[17]}" as 계약구분,
                        "{col_names[16]}" as 계약기간,
                        "{col_names[19]}" as 종전계약보증금,
                        "{col_names[20]}" as 종전계약월세,
                        "{col_names[18]}" as 갱신요구권사용
                    FROM dagagu_rent_transactions
                    WHERE 1=1
                """
                params = []

                # 1. 지역 필터를 먼저 적용 (인덱스 활용)
                if sgg_codes:
                    placeholders = ','.join(['%s'] * len(sgg_codes))
                    query += f" AND sggcd IN ({placeholders})"
                    params.extend(sgg_codes)

                # 2. 읍면동 필터 추가
                if umd_names and len(umd_names) > 0:
                    placeholders = ','.join(['%s'] * len(umd_names))
                    query += f" AND umdnm IN ({placeholders})"
                    params.extend(umd_names)

                # 3. 계약만기시기 필터 (col_names[16]: 계약기간)
                if contract_end:
                    if len(contract_end) == 6:  # YYYYMM 형식
                        # 단독다가구는 YYYYMM 형식을 그대로 사용 (202508~202608 형태)
                        query += f' AND SPLIT_PART("{col_names[16]}", \'~\', 2) = %s'
                        params.append(contract_end)  # ~202512로 끝나는 것만
                    else:
                        query += f' AND SPLIT_PART("{col_names[16]}", \'~\', 2) = %s'
                        params.append(contract_end)

                if area_min:
                    query += f' AND CAST("{col_names[8]}" AS FLOAT) >= %s'
                    params.append(area_min)
                if area_max:
                    query += f' AND CAST("{col_names[8]}" AS FLOAT) <= %s'
                    params.append(area_max)

                if deposit_min:
                    query += f' AND CAST(REPLACE("{col_names[12]}", \',\', \'\') AS INTEGER) >= %s'
                    params.append(deposit_min)
                if deposit_max:
                    query += f' AND CAST(REPLACE("{col_names[12]}", \',\', \'\') AS INTEGER) <= %s'
                    params.append(deposit_max)

                if rent_min:
                    query += f' AND CAST(REPLACE("{col_names[13]}", \',\', \'\') AS INTEGER) >= %s'
                    params.append(rent_min)
                if rent_max:
                    query += f' AND CAST(REPLACE("{col_names[13]}", \',\', \'\') AS INTEGER) <= %s'
                    params.append(rent_max)

                if build_year_min:
                    query += f''' AND CASE
                        WHEN "{col_names[14]}" IS NULL OR "{col_names[14]}" = '' THEN FALSE
                        WHEN CAST("{col_names[14]}" AS TEXT) ~ '^[0-9]+\.?[0-9]*$' THEN CAST(CAST("{col_names[14]}" AS FLOAT) AS INTEGER) >= %s
                        ELSE FALSE
                    END'''
                    params.append(build_year_min)
                if build_year_max:
                    query += f''' AND CASE
                        WHEN "{col_names[14]}" IS NULL OR "{col_names[14]}" = '' THEN FALSE
                        WHEN CAST("{col_names[14]}" AS TEXT) ~ '^[0-9]+\.?[0-9]*$' THEN CAST(CAST("{col_names[14]}" AS FLOAT) AS INTEGER) <= %s
                        ELSE FALSE
                    END'''
                    params.append(build_year_max)

                query += " ORDER BY 계약년월 DESC, 계약일 DESC LIMIT %s OFFSET %s"
                params.extend([page_size, offset])

                cursor.execute(query, params)
                results = cursor.fetchall()
                result_counts.append(len(results))  # 건수 추적

                for row in results:
                    sgg_code = row.get('시군구코드')
                    if sgg_code and sgg_code in REGIONS['sigungu']:
                        sido_full = REGIONS['sigungu'][sgg_code]['sido']
                        row['시도'] = SIDO_ABBR.get(sido_full, sido_full)  # 축약형 사용
                        row['시군구'] = REGIONS['sigungu'][sgg_code]['name']
                    else:
                        row['시도'] = ''
                        row['시군구'] = ''

                    # 단독다가구는 호실 정보 없음
                    row['동호명'] = '-'
                    row['동호명_전체목록'] = []
                    row['동호명_더보기'] = False

                all_results.extend(results)
            except Exception as e:
                print(f"[WARNING] 단독다가구 조회 오류: {str(e)}")

        cursor.close()
        conn.close()

        # has_more 판단: 어떤 유형이라도 page_size만큼 조회되었다면 더 있을 가능성이 있음
        has_more = any(count == page_size for count in result_counts)

        return jsonify({
            'success': True,
            'data': all_results,
            'count': len(all_results),
            'has_more': has_more
        })

    except Exception as e:
        print(f"[ERROR] 검색 오류: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': f'검색 중 오류가 발생했습니다: {str(e)}'
        })


@app.route('/api/building-transactions', methods=['GET', 'POST'])
def get_building_transactions():
    """특정 주소의 모든 실거래가 조회 (페이지네이션 지원)"""
    try:
        # GET과 POST 모두 지원
        if request.method == 'GET':
            building_name = (request.args.get('building_name') or '').strip()
            property_type = (request.args.get('property_type') or '').strip()
            sigungu_code = (request.args.get('sgg_code') or '').strip()
            umd_name = (request.args.get('umd_name') or '').strip()
            jibun = (request.args.get('jibun') or '').strip()
            page = int(request.args.get('page', 1))
            page_size = int(request.args.get('page_size', 30))  # 성능 최적화: 50 → 30
        else:
            data = request.get_json()
            building_name = (data.get('building_name') or '').strip()
            property_type = (data.get('property_type') or '').strip()
            sigungu_code = (data.get('sigungu_code') or '').strip()
            umd_name = (data.get('umd_name') or '').strip()
            jibun = (data.get('jibun') or '').strip()
            page = int(data.get('page', 1))
            page_size = int(data.get('page_size', 30))  # 성능 최적화: 50 → 30

        # 페이지네이션 계산
        offset = (page - 1) * page_size

        # 디버깅 로그
        print(f"[DEBUG 모달] 조회 요청 - 주택유형: {property_type}, 시군구코드: {sigungu_code}, 읍면동: {umd_name}, 지번: {jibun}, 건물명: {building_name}, 페이지: {page}, 페이지크기: {page_size}, OFFSET: {offset}")

        if not property_type or not sigungu_code or not umd_name:
            return jsonify({
                'success': False,
                'error': '주택유형, 시군구코드, 읍면동은 필수입니다.'
            })

        conn = get_db_connection()
        cursor = conn.cursor()

        results = []

        # 주택 유형에 따라 테이블 선택
        table_map = {
            '아파트': 'apt_rent_transactions',
            '연립다세대': 'villa_rent_transactions',
            '오피스텔': 'officetel_rent_transactions',
            '단독다가구': 'dagagu_rent_transactions'
        }

        table_name = table_map.get(property_type)
        if not table_name:
            return jsonify({
                'success': False,
                'error': '잘못된 주택 유형입니다.'
            })

        # 컬럼명 가져오기
        cursor.execute(f'SELECT * FROM {table_name} LIMIT 0')
        col_names = [desc[0] for desc in cursor.description]

        # 쿼리 작성 - 각 테이블 구조에 맞게 필터링
        params = [sigungu_code, umd_name]

        if property_type == '단독다가구':
            # 단독다가구: sggcd(1), umdnm(3), jibun(4), 도로명(15)
            where_clause = f'"{col_names[1]}" = %s AND "{col_names[3]}" = %s'
            if jibun:
                where_clause += f' AND "{col_names[4]}" = %s'
                params.append(jibun)
            if building_name:
                where_clause += f' AND "{col_names[15]}" = %s'
                params.append(building_name)

        elif property_type == '연립다세대':
            # 연립다세대: sggcd(1), umdnm(2), jibun(3), mhousename(4)
            where_clause = f'"{col_names[1]}" = %s AND "{col_names[2]}" = %s'
            if jibun:
                where_clause += f' AND "{col_names[3]}" = %s'
                params.append(jibun)
            if building_name:
                where_clause += f' AND "{col_names[4]}" = %s'
                params.append(building_name)

        elif property_type == '오피스텔':
            # 오피스텔: sggcd(1), umdnm(3), jibun(4), offinm(5)
            where_clause = f'"{col_names[1]}" = %s AND "{col_names[3]}" = %s'
            if jibun:
                where_clause += f' AND "{col_names[4]}" = %s'
                params.append(jibun)
            if building_name:
                where_clause += f' AND "{col_names[5]}" = %s'
                params.append(building_name)

        else:  # 아파트
            # 아파트: sggcd(1), umdnm(2), jibun(3), aptnm(4)
            where_clause = f'"{col_names[1]}" = %s AND "{col_names[2]}" = %s'
            if jibun:
                where_clause += f' AND "{col_names[3]}" = %s'
                params.append(jibun)
            if building_name:
                where_clause += f' AND "{col_names[4]}" = %s'
                params.append(building_name)

        print(f"[DEBUG] WHERE 절: {where_clause}")
        print(f"[DEBUG] 파라미터: {params}")

        if property_type == '단독다가구':
            # 단독다가구: jibun(4), 계약면적(8), 계약년월(10), 계약일(11), 보증금(12), 월세(13),
            # 건축년도(14), 도로명(15), 계약기간(16), 계약구분(17), 갱신요구권사용(18),
            # 종전계약보증금(19), 종전계약월세(20)
            query = f'''
                SELECT
                    "{col_names[1]}" as 시군구코드,
                    "{col_names[3]}" as 읍면동리,
                    COALESCE(NULLIF("{col_names[4]}", ''), '') as 지번,
                    '-' as 층,
                    COALESCE(CAST("{col_names[8]}" AS TEXT), '') as 면적,
                    COALESCE(NULLIF("{col_names[12]}", ''), '') as 보증금,
                    COALESCE(NULLIF("{col_names[13]}", ''), '') as 월세,
                    COALESCE(NULLIF("{col_names[10]}", ''), '') as 계약년월,
                    COALESCE(NULLIF("{col_names[11]}", ''), '') as 계약일,
                    CASE
                        WHEN "{col_names[14]}" IS NULL OR "{col_names[14]}" = '' THEN NULL
                        WHEN CAST("{col_names[14]}" AS TEXT) ~ '^[0-9]+\.?[0-9]*$' THEN
                            CASE
                                WHEN CAST("{col_names[14]}" AS FLOAT) BETWEEN 1800 AND 2200 THEN CAST(CAST("{col_names[14]}" AS FLOAT) AS INTEGER)
                                ELSE NULL
                            END
                        ELSE NULL
                    END as 건축년도,
                    COALESCE(NULLIF("{col_names[17]}", ''), '') as 계약구분,
                    COALESCE(NULLIF("{col_names[16]}", ''), '') as 계약기간,
                    COALESCE(NULLIF("{col_names[19]}", ''), '') as 종전계약보증금,
                    COALESCE(NULLIF("{col_names[20]}", ''), '') as 종전계약월세,
                    COALESCE(NULLIF("{col_names[18]}", ''), '') as 갱신요구권사용
                FROM {table_name}
                WHERE {where_clause}
                ORDER BY "{col_names[10]}" DESC, CAST(NULLIF("{col_names[11]}", '') AS INTEGER) DESC NULLS LAST
                LIMIT %s OFFSET %s
            '''
        elif property_type == '연립다세대':
            # 연립다세대: jibun(3), excluusear(5), dealyear(6), dealmonth(7), dealday(8),
            # deposit(9), monthlyrent(10), floor(11), buildyear(12), contracttype(14),
            # contractterm(15), predeposit(16), premonthlyrent(17), userrright(18)
            query = f'''
                SELECT
                    "{col_names[1]}" as 시군구코드,
                    "{col_names[2]}" as 읍면동리,
                    COALESCE(NULLIF("{col_names[3]}", ''), '') as 지번,
                    COALESCE(NULLIF("{col_names[11]}", ''), '') as 층,
                    COALESCE(NULLIF("{col_names[5]}", ''), '') as 면적,
                    COALESCE(NULLIF("{col_names[9]}", ''), '') as 보증금,
                    COALESCE(NULLIF("{col_names[10]}", ''), '') as 월세,
                    CONCAT(
                        LPAD(COALESCE(NULLIF("{col_names[6]}", ''), ''), 4, '0'),
                        LPAD(COALESCE(NULLIF("{col_names[7]}", ''), ''), 2, '0')
                    ) as 계약년월,
                    COALESCE(NULLIF("{col_names[8]}", ''), '') as 계약일,
                    COALESCE(NULLIF("{col_names[12]}", ''), '') as 건축년도,
                    COALESCE(NULLIF("{col_names[14]}", ''), '') as 계약구분,
                    COALESCE(NULLIF("{col_names[15]}", ''), '') as 계약기간,
                    COALESCE(NULLIF("{col_names[16]}", ''), '') as 종전계약보증금,
                    COALESCE(NULLIF("{col_names[17]}", ''), '') as 종전계약월세,
                    COALESCE(NULLIF("{col_names[18]}", ''), '') as 갱신요구권사용
                FROM {table_name}
                WHERE {where_clause}
                ORDER BY CONCAT(
                    LPAD(COALESCE(NULLIF("{col_names[6]}", ''), ''), 4, '0'),
                    LPAD(COALESCE(NULLIF("{col_names[7]}", ''), ''), 2, '0')
                ) DESC, CAST(NULLIF("{col_names[8]}", '') AS INTEGER) DESC NULLS LAST
                LIMIT %s OFFSET %s
            '''
        elif property_type == '오피스텔':
            # 오피스텔: jibun(4), excluusear(6), floor(7), buildyear(8), dealyear(9),
            # dealmonth(10), dealday(11), deposit(12), monthlyrent(13), contracttype(14),
            # contractterm(15), predeposit(16), premonthlyrent(17), userrright(18)
            # 성능 최적화: LEFT JOIN 제거, batch fetch로 기준시가 조회
            query = f'''
                SELECT
                    COALESCE(NULLIF("{col_names[4]}", ''), '') as 지번,
                    COALESCE(NULLIF("{col_names[7]}", ''), '') as 층,
                    COALESCE(NULLIF("{col_names[6]}", ''), '') as 면적,
                    COALESCE(NULLIF("{col_names[12]}", ''), '') as 보증금,
                    COALESCE(NULLIF("{col_names[13]}", ''), '') as 월세,
                    CONCAT(
                        LPAD(COALESCE(NULLIF("{col_names[9]}", ''), ''), 4, '0'),
                        LPAD(COALESCE(NULLIF("{col_names[10]}", ''), ''), 2, '0')
                    ) as 계약년월,
                    COALESCE(NULLIF("{col_names[11]}", ''), '') as 계약일,
                    COALESCE(NULLIF("{col_names[8]}", ''), '') as 건축년도,
                    COALESCE(NULLIF("{col_names[14]}", ''), '') as 계약구분,
                    COALESCE(NULLIF("{col_names[15]}", ''), '') as 계약기간,
                    COALESCE(NULLIF("{col_names[16]}", ''), '') as 종전계약보증금,
                    COALESCE(NULLIF("{col_names[17]}", ''), '') as 종전계약월세,
                    COALESCE(NULLIF("{col_names[18]}", ''), '') as 갱신요구권사용
                FROM {table_name}
                WHERE {where_clause}
                ORDER BY CONCAT(
                    LPAD(COALESCE(NULLIF("{col_names[9]}", ''), ''), 4, '0'),
                    LPAD(COALESCE(NULLIF("{col_names[10]}", ''), ''), 2, '0')
                ) DESC, CAST(NULLIF("{col_names[11]}", '') AS INTEGER) DESC NULLS LAST
                LIMIT %s OFFSET %s
            '''
        else:  # 아파트
            # 아파트: jibun(3), aptnm(4), excluusear(5), floor(6), buildyear(7),
            # dealyear(8), dealmonth(9), dealday(10), deposit(11), monthlyrent(12),
            # contractterm(13), contracttype(14), userrright(15), predeposit(16), premonthlyrent(17)
            query = f'''
                SELECT
                    COALESCE(NULLIF("{col_names[3]}", ''), '') as 지번,
                    COALESCE(NULLIF("{col_names[6]}", ''), '') as 층,
                    COALESCE(NULLIF("{col_names[5]}", ''), '') as 면적,
                    COALESCE(NULLIF("{col_names[11]}", ''), '') as 보증금,
                    COALESCE(NULLIF("{col_names[12]}", ''), '') as 월세,
                    CONCAT(
                        LPAD(COALESCE(NULLIF("{col_names[8]}", ''), ''), 4, '0'),
                        LPAD(COALESCE(NULLIF("{col_names[9]}", ''), ''), 2, '0')
                    ) as 계약년월,
                    COALESCE(NULLIF("{col_names[10]}", ''), '') as 계약일,
                    COALESCE(NULLIF("{col_names[7]}", ''), '') as 건축년도,
                    COALESCE(NULLIF("{col_names[14]}", ''), '') as 계약구분,
                    COALESCE(NULLIF("{col_names[13]}", ''), '') as 계약기간,
                    COALESCE(NULLIF("{col_names[16]}", ''), '') as 종전계약보증금,
                    COALESCE(NULLIF("{col_names[17]}", ''), '') as 종전계약월세,
                    COALESCE(NULLIF("{col_names[15]}", ''), '') as 갱신요구권사용
                FROM {table_name}
                WHERE {where_clause}
                ORDER BY CONCAT(
                    LPAD(COALESCE(NULLIF("{col_names[8]}", ''), ''), 4, '0'),
                    LPAD(COALESCE(NULLIF("{col_names[9]}", ''), ''), 2, '0')
                ) DESC, CAST(NULLIF("{col_names[10]}", '') AS INTEGER) DESC NULLS LAST
                LIMIT %s OFFSET %s
            '''

        # Add pagination parameters to query params
        params.extend([page_size, offset])

        cursor.execute(query, params)
        results = cursor.fetchall()

        print(f"[DEBUG] 조회 결과 건수: {len(results)}")
        if len(results) > 0:
            print(f"[DEBUG] 첫 번째 결과: {results[0]}")

        # 오피스텔의 경우 기준시가 일괄 조회
        if table_name == 'officetel_rent_transactions':
            print(f"[DEBUG 모달오피스텔] 오피스텔 기준시가 일괄 조회 시작")
            price_map = fetch_officetel_standard_prices_batch(cursor, sigungu_code, results)

            print(f"[DEBUG 모달오피스텔] price_map 크기: {len(price_map)}건")

            # 결과 매핑
            matched_count = 0
            for row in results:
                jibun = row.get('지번')
                floor = row.get('층')
                area = row.get('면적')

                if jibun and floor is not None and area:
                    try:
                        area_rounded = round(float(area), 2)
                        key = (jibun, int(floor), area_rounded)
                        if key in price_map:
                            data = price_map[key]
                            row['기준시가_면적당가격'] = data['unit_price']
                            row['기준시가_전용면적'] = data['exclusive_area']
                            row['기준시가_공유면적'] = data['shared_area']
                            row['기준시가_면적계'] = data['total_area']
                            row['기준시가_총액'] = data['standard_price']
                            row['기준시가_126퍼센트'] = data['threshold_126']
                            matched_count += 1
                    except Exception as e:
                        print(f"[DEBUG 모달오피스텔] 매핑 예외: {e}")
                        pass

            print(f"[DEBUG 모달오피스텔] 매칭 완료: {matched_count}/{len(results)}건")

        # 아파트/연립다세대의 경우 공동주택가격 조회 추가 (일괄 조회로 최적화)
        if property_type in ['아파트', '연립다세대']:
            conn_apt = get_db_connection()
            cursor_apt = conn_apt.cursor()

            # N+1 쿼리 문제 해결: 한 번의 쿼리로 모든 공동주택가격 조회
            price_map = fetch_apartment_prices_batch(cursor_apt, sigungu_code, umd_name, results)

            print(f"[DEBUG 모달매핑] price_map 크기: {len(price_map)}건")
            if price_map:
                sample_key = list(price_map.keys())[0]
                print(f"[DEBUG 모달매핑] price_map 샘플 키: {sample_key}")

            # 결과 매핑
            matched_count = 0
            for row in results:
                jibun = row.get('지번')
                floor = row.get('층')
                area = row.get('면적')

                if jibun and floor is not None and area:
                    try:
                        # 면적을 2자리로 반올림하여 키 생성 (batch 함수와 동일하게)
                        area_rounded = round(float(area), 2)
                        key = (jibun, int(floor), area_rounded)

                        if key in price_map:
                            row['공동주택가격'] = price_map[key]['price']
                            row['공동주택가격_126퍼센트'] = price_map[key]['threshold_126']
                            matched_count += 1
                        else:
                            print(f"[DEBUG 모달매핑] 매칭 실패 - 키: {key}, 지번={jibun}, 층={floor}, 면적={area}")
                    except Exception as e:
                        print(f"[DEBUG 모달매핑] 예외 발생: {e}")
                        pass

            print(f"[DEBUG 모달매핑] 매칭 완료: {matched_count}/{len(results)}건")

            cursor_apt.close()

        # 호실 정보 추가 (아파트, 연립다세대, 오피스텔에만 적용)
        if property_type in ['아파트', '연립다세대', '오피스텔']:
            # 커서를 다시 열어서 호실 정보 조회
            conn_unit = psycopg.connect(**DB_CONFIG, row_factory=dict_row)
            cursor_unit = conn_unit.cursor()

            for row in results:
                unit_info = fetch_unit_info_for_row(
                    cursor_unit,
                    sigungu_code,
                    umd_name,
                    row.get('지번'),
                    row.get('층'),
                    row.get('면적')
                )
                row['동호명'] = unit_info['unit']
                row['동호명_전체목록'] = unit_info['all_units']
                row['동호명_더보기'] = unit_info['has_more']

            cursor_unit.close()
            conn_unit.close()
        else:
            # 단독다가구는 호실 정보 없음
            for row in results:
                row['동호명'] = '-'
                row['동호명_전체목록'] = []
                row['동호명_더보기'] = False

        cursor.close()
        # 연결은 재사용을 위해 닫지 않음

        # has_more 판단: page_size만큼 조회되었다면 더 있을 가능성이 있음
        has_more = len(results) == page_size

        return jsonify({
            'success': True,
            'data': results,
            'count': len(results),
            'has_more': has_more,
            'building_name': building_name,
            'address': f"{umd_name} {jibun}" if jibun else umd_name
        })

    except Exception as e:
        print(f"[ERROR] 건물 조회 오류: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': f'조회 중 오류가 발생했습니다: {str(e)}'
        })


@app.route('/api/search-building', methods=['GET'])
def search_building():
    """건물 검색 (읍면동+지번 자동완성) - 캐시 사용"""
    try:
        query = request.args.get('q', '').strip()

        if len(query) < 2:
            return jsonify({
                'success': False,
                'error': '검색어는 최소 2글자 이상 입력해주세요.'
            })

        # 쿼리 파싱: "도곡동 544-5" 또는 "도곡동544-5"
        # 공백 또는 첫 숫자가 나오는 지점에서 읍면동과 지번 분리
        import re
        match = re.match(r'^([^\d\s]+)\s*(.+)$', query)

        if not match:
            return jsonify({
                'success': False,
                'error': '읍면동명과 지번을 함께 입력해주세요.'
            })

        umd_name = match.group(1).strip()  # 정확한 읍면동명
        jibun_search = match.group(2).strip()  # 지번 검색어

        # 실시간 DB 검색 (캐시 대신)
        buildings = []
        seen = set()  # 중복 제거용
        MAX_RESULTS = 12  # 최대 결과 수

        # DB 연결
        conn = get_db_connection()
        cursor = conn.cursor()

        # 4개 테이블에서 검색
        tables = [
            ('apt_rent_transactions', 'aptnm', '아파트'),
            ('villa_rent_transactions', 'mhousename', '연립다세대'),
            ('officetel_rent_transactions', 'offinm', '오피스텔'),
            ('dagagu_rent_transactions', 'NULL', '단독다가구')
        ]

        for table_name, building_col, property_type in tables:
            if len(buildings) >= MAX_RESULTS:
                break

            # 읍면동과 지번으로 검색 (LIKE 사용)
            query = f"""
                SELECT DISTINCT sggcd, umdnm, jibun, {building_col} as building_name
                FROM {table_name}
                WHERE umdnm = %s AND jibun LIKE %s
                LIMIT {MAX_RESULTS}
            """
            cursor.execute(query, (umd_name, f"{jibun_search}%"))

            for row in cursor.fetchall():
                if len(buildings) >= MAX_RESULTS:
                    break

                sgg_code = row['sggcd']
                jibun = row['jibun']
                building_name = row['building_name']

                key = (sgg_code, umd_name, jibun, building_name)
                if key not in seen:
                    seen.add(key)

                    # 시도/시군구 정보 추출
                    sido = ''
                    sigungu = ''
                    if sgg_code and sgg_code in REGIONS['sigungu']:
                        sido_full = REGIONS['sigungu'][sgg_code]['sido']
                        sido = SIDO_ABBR.get(sido_full, sido_full)
                        sigungu = REGIONS['sigungu'][sgg_code]['name']

                    buildings.append({
                        'sgg_code': sgg_code,
                        'umd_name': umd_name,
                        'jibun': jibun,
                        'building_name': building_name,
                        'property_type': property_type,
                        'sido': sido,
                        'sigungu': sigungu,
                        'full_address': f"{umd_name} {jibun} {building_name or ''}"
                    })

        cursor.close()

        return jsonify({
            'success': True,
            'buildings': buildings
        })

    except Exception as e:
        print(f"건물 검색 오류: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': f'검색 중 오류가 발생했습니다: {str(e)}'
        })


@app.route('/api/unit-info', methods=['POST'])
def get_unit_info():
    """호실 정보 조회 (동·호명 특정)"""
    try:
        data = request.get_json()
        sggcd = data.get('sggcd')
        umdnm = data.get('umdnm')
        jibun = data.get('jibun')
        floor = data.get('floor')
        excluusear = data.get('excluusear')

        print(f"[DEBUG] 호실 조회 요청 - 시군구:{sggcd}, 읍면동:{umdnm}, 지번:{jibun}, 층:{floor}, 면적:{excluusear}")

        # 필수 파라미터 확인
        if not all([sggcd, umdnm, jibun, floor is not None, excluusear]):
            print(f"[DEBUG] 필수 파라미터 누락")
            return jsonify({'unit': '-', 'error': 'Missing parameters'})

        # 법정동코드 5자리 찾기 (읍면동 부분)
        bjdcd = None
        for code, info in REGIONS['umd'].items():
            if info['sgg_code'] == sggcd and info['umd_name'] == umdnm:
                bjdcd = code[5:]  # 뒤 5자리가 법정동코드
                break

        if not bjdcd:
            print(f"[DEBUG] 법정동코드 찾기 실패 - sggcd:{sggcd}, umdnm:{umdnm}")
            return jsonify({'unit': '-', 'error': 'BJD code not found'})
        
        print(f"[DEBUG] 법정동코드: {bjdcd}")

        # 지번 파싱: "17-3" → 번 "0017", 지 "0003" / "134" → 번 "0134", 지 "0000"
        jibun_parts = str(jibun).split('-')
        bon = jibun_parts[0].strip().zfill(4)
        bu = jibun_parts[1].strip().zfill(4) if len(jibun_parts) > 1 else '0000'

        # 층 처리: 음수(-1) → 층_구분_코드 '10'(지하), 층_번호 '1'
        #         양수(5) → 층_구분_코드 '20'(지상), 층_번호 '5'
        try:
            floor_int = int(float(floor))
        except (ValueError, TypeError):
            return jsonify({'unit': '-', 'error': 'Invalid floor'})

        if floor_int < 0:
            floor_code = '10'  # 지하
            floor_num = str(abs(floor_int))
        else:
            floor_code = '20'  # 지상
            floor_num = str(floor_int)

        # 면적은 소수점까지 완전 일치해야 함
        try:
            area = str(float(excluusear))
        except (ValueError, TypeError):
            return jsonify({'unit': '-', 'error': 'Invalid area'})

        # DB 쿼리 (최적화)
        conn = get_db_connection()
        cursor = conn.cursor()

        # 쿼리 타임아웃 설정 (10초)
        cursor.execute("SET statement_timeout = '10s'")

        # 최적화된 쿼리:
        # 1. 전유_공용_구분_코드를 먼저 필터 (가장 선택적)
        # 2. 시군구_코드, 법정동_코드로 지역 좁히기
        # 3. 번, 지로 지번 좁히기
        # 4. 면적을 TEXT로 정확히 매칭 (데이터베이스 인덱스 없이는 numeric 변환이 느림)
        # 5. 층 조건은 마지막
        query = """
        SELECT DISTINCT "동_명", "호_명"
        FROM bldg_exclusive_area
        WHERE "전유_공용_구분_코드" = '1'
          AND "시군구_코드" = %s
          AND "법정동_코드" = %s
          AND "번" = %s
          AND "지" = %s
          AND "층_구분_코드" = %s
          AND "층_번호" = %s
          AND "면적(㎡)" = %s
        LIMIT 100
        """

        print(f"[DEBUG] 쿼리 파라미터: sggcd={sggcd}, bjdcd={bjdcd}, 번={bon}, 지={bu}, 층구분={floor_code}, 층번호={floor_num}, 면적={area}")
        import time
        start_time = time.time()

        try:
            cursor.execute(query, (sggcd, bjdcd, bon, bu, floor_code, floor_num, area))
            results = cursor.fetchall()
            elapsed = time.time() - start_time
            print(f"[DEBUG] 쿼리 실행 시간: {elapsed:.2f}초, 결과 건수: {len(results)}건")
        except psycopg.errors.QueryCanceled:
            print(f"[DEBUG] 쿼리 타임아웃 (10초 초과)")
            cursor.close()
            conn.close()
            return jsonify({'unit': '-', 'error': 'Query timeout'})

        cursor.close()
        conn.close()

        # 결과 처리
        if not results:
            return jsonify({'unit': '-'})

        # 모든 고유한 동명+호명 조합 수집
        unique_units = set()
        for r in results:
            dong = (r.get('동_명', '').strip() if r.get('동_명') else '')
            ho = (r.get('호_명', '').strip() if r.get('호_명') else '')
            if dong and ho:
                unique_units.add(f"{dong} {ho}")
            elif ho:  # 동명 없이 호명만 있는 경우
                unique_units.add(ho)

        if not unique_units:
            print(f"[DEBUG] 호실 정보 없음")
            return jsonify({'unit': '-', 'all_units': []})

        # 전체 목록 (정렬)
        all_unit_list = sorted(list(unique_units))

        # 표시용: 최대 10개까지만
        display_list = all_unit_list[:10]
        unit_str = ', '.join(display_list)

        if len(unique_units) > 10:
            unit_str += f" 외 {len(unique_units) - 10}개"

        print(f"[DEBUG] 호실 특정: {len(unique_units)}개 - {unit_str}")
        return jsonify({
            'unit': unit_str,
            'all_units': all_unit_list,  # 전체 목록 (툴팁용)
            'has_more': len(unique_units) > 10
        })

    except Exception as e:
        print(f"[ERROR] 호실 조회 오류: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'unit': '-', 'error': str(e)})


@app.route('/api/owner-info', methods=['POST'])
def get_owner_info():
    """VWorld API를 통한 토지소유정보 조회"""
    # 임시로 기능 비활성화 (502 에러 해결을 위해)
    return jsonify({
        'error': '소유자 정보 조회 기능이 일시적으로 비활성화되었습니다.',
        'message': 'API 안정화 작업 중입니다.'
    }), 503

    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'JSON 데이터가 필요합니다.'}), 400

        sgg_code = data.get('sgg_code')  # 시군구코드 (5자리)
        umd_name = data.get('umd_name')  # 읍면동명
        jibun = data.get('jibun')  # 지번 (예: "119-3")

        # 디버그 로그 출력
        print(f"[DEBUG] 소유자 정보 조회 요청 - 시군구:{sgg_code}, 읍면동:{umd_name}, 지번:{jibun}")

        # 필수 파라미터 확인
        if not all([sgg_code, umd_name, jibun]):
            return jsonify({'error': '필수 파라미터가 누락되었습니다.'}), 400

        # REGIONS 캐시에서 법정동코드 찾기
        if not REGIONS or 'umd' not in REGIONS:
            print(f"[ERROR] REGIONS 캐시가 초기화되지 않았습니다.")
            return jsonify({'error': '지역 코드 정보를 불러올 수 없습니다.'}), 500

        umd_code = None
        for full_code, region_info in REGIONS['umd'].items():
            if region_info.get('sgg_code') == sgg_code and region_info.get('umd_name') == umd_name:
                umd_code = full_code[5:]  # 뒤 5자리가 법정동코드
                break

        if not umd_code:
            print(f"[ERROR] 법정동코드를 찾을 수 없습니다 - 시군구:{sgg_code}, 읍면동:{umd_name}")
            return jsonify({'error': '법정동코드를 찾을 수 없습니다.'}), 404

        # 지번 파싱: "119-3" → 본번 "0119", 부번 "0003"
        jibun_parts = str(jibun).split('-')
        bon = jibun_parts[0].strip().zfill(4)
        bu = jibun_parts[1].strip().zfill(4) if len(jibun_parts) > 1 else '0000'

        # PNU 생성: 시군구코드(5) + 법정동코드(5) + 1 + 본번(4) + 부번(4)
        pnu = f"{sgg_code}{umd_code}1{bon}{bu}"

        print(f"[DEBUG] 법정동코드: {umd_code}, PNU: {pnu}")

        # VWorld API 호출
        api_key = os.getenv('VWORLD_API_KEY')
        if not api_key:
            return jsonify({'error': 'VWorld API Key가 설정되지 않았습니다.'}), 500

        api_url = "https://api.vworld.kr/ned/data/getPossessionAttr"
        params = {
            'pnu': pnu,
            'format': 'xml',
            'numOfRows': 1000,
            'pageNo': 1,
            'key': api_key,
            'domain': 'http://127.0.0.1'
        }

        print(f"[DEBUG] VWorld API 호출 중... params: {params}")

        try:
            response = requests.get(api_url, params=params, timeout=5)
        except requests.Timeout:
            print(f"[ERROR] VWorld API 타임아웃")
            return jsonify({'error': 'VWorld API 응답 시간 초과'}), 504
        except requests.RequestException as e:
            print(f"[ERROR] VWorld API 요청 실패: {str(e)}")
            return jsonify({'error': f'API 요청 실패: {str(e)}'}), 500

        print(f"[DEBUG] VWorld API 응답 상태: {response.status_code}")

        if response.status_code != 200:
            print(f"[ERROR] VWorld API 호출 실패: {response.status_code}")
            print(f"[ERROR] 응답 내용: {response.text[:500]}")
            return jsonify({'error': f'API 호출 실패 (상태코드: {response.status_code})'}), 502

        # XML 파싱
        try:
            print(f"[DEBUG] 응답 내용 (처음 300자): {response.content[:300]}")

            root = ET.fromstring(response.content)

            # VWorld API는 <fields><field> 구조로 응답
            # possessions가 아니라 field 태그를 찾아야 함
            fields = root.findall('.//field')

            print(f"[DEBUG] field 태그 개수: {len(fields)}")

            if not fields:
                print(f"[DEBUG] 소유자 정보 없음")
                return jsonify({'data': {}, 'message': '소유자 정보가 없습니다.'})

            # 결과 파싱
            results = []
            for field in fields:
                item = {}
                for child in field:
                    tag = child.tag
                    value = child.text or ''
                    item[tag] = value
                results.append(item)

            print(f"[DEBUG] 소유자 정보 {len(results)}건 조회 완료")

            # 동·호별로 그룹화
            grouped_data = {}
            for item in results:
                dong_nm = item.get('buldDongNm', '')
                ho_nm = item.get('buldHoNm', '')

                # 0000이나 빈 값은 무시
                dong_nm = dong_nm if dong_nm and dong_nm != '0000' else ''
                ho_nm = ho_nm if ho_nm and ho_nm != '0000' else ''

                # 집합건물인 경우에만 동·호 그룹화, 아니면 전체를 하나의 그룹으로
                if dong_nm and ho_nm:
                    key = f"{dong_nm}동 {ho_nm}호"
                elif dong_nm:
                    key = f"{dong_nm}동"
                elif ho_nm:
                    key = f"{ho_nm}호"
                else:
                    key = "토지"

                if key not in grouped_data:
                    grouped_data[key] = []

                grouped_data[key].append({
                    'posesnSeCodeNm': item.get('posesnSeCodeNm', '-'),
                    'resdncSeCodeNm': item.get('resdncSeCodeNm', '-'),
                    'ownshipChgDe': item.get('ownshipChgDe', '-'),
                    'ownshipChgCauseCodeNm': item.get('ownshipChgCauseCodeNm', '-'),
                    'cnrsPsnCo': item.get('cnrsPsnCo', '0'),
                    'buldDongNm': dong_nm,
                    'buldHoNm': ho_nm
                })

            return jsonify({'data': grouped_data})

        except ET.ParseError as e:
            print(f"[ERROR] XML 파싱 오류: {str(e)}")
            return jsonify({'error': 'API 응답 파싱 실패'}), 500

    except Exception as e:
        print(f"[ERROR] 소유자 정보 조회 오류: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'소유자 정보 조회 실패: {str(e)}'}), 500




if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
