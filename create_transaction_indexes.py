#!/usr/bin/env python3
"""
거래 데이터 테이블 인덱스 생성 스크립트
apt_rent_transactions, villa_rent_transactions, officetel_rent_transactions, dagagu_rent_transactions
테이블에 검색 최적화를 위한 인덱스 추가
"""

import os
import psycopg
from dotenv import load_dotenv
import time

# .env 파일 로드
load_dotenv()

DB_CONFIG = {
    'host': os.getenv('PG_HOST'),
    'dbname': os.getenv('PG_DB'),
    'user': os.getenv('PG_USER'),
    'password': os.getenv('PG_PASSWORD'),
    'port': os.getenv('PG_PORT'),
    'connect_timeout': 30
}

def create_transaction_indexes():
    """거래 테이블 검색 최적화를 위한 인덱스 생성"""
    print("데이터베이스 연결 중...")
    conn = psycopg.connect(**DB_CONFIG, autocommit=True)
    cursor = conn.cursor()

    # 4개 거래 테이블
    tables = [
        'apt_rent_transactions',
        'villa_rent_transactions',
        'officetel_rent_transactions',
        'dagagu_rent_transactions'
    ]

    try:
        for table_name in tables:
            print(f"\n{'='*60}")
            print(f"테이블: {table_name}")
            print(f"{'='*60}")

            # 기존 인덱스 확인
            print("\n기존 인덱스 확인 중...")
            cursor.execute("""
                SELECT indexname, indexdef
                FROM pg_indexes
                WHERE tablename = %s
                ORDER BY indexname
            """, (table_name,))
            existing_indexes = cursor.fetchall()
            print(f"기존 인덱스 {len(existing_indexes)}개:")
            for idx_name, idx_def in existing_indexes:
                print(f"  - {idx_name}")

            # 생성할 인덱스들 (이름, SQL, 설명)
            indexes_to_create = [
                (
                    f"idx_{table_name}_sggcd_umdnm",
                    f"""
                    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_{table_name}_sggcd_umdnm
                    ON {table_name} (sggcd, umdnm)
                    """,
                    "시군구+읍면동 복합 인덱스 (지역 필터링)"
                ),
                (
                    f"idx_{table_name}_contractterm",
                    f"""
                    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_{table_name}_contractterm
                    ON {table_name} (contractterm)
                    """,
                    "계약기간 인덱스 (계약만기시기 필터링)"
                ),
                (
                    f"idx_{table_name}_jibun",
                    f"""
                    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_{table_name}_jibun
                    ON {table_name} (jibun)
                    """,
                    "지번 인덱스 (주소 검색)"
                ),
                (
                    f"idx_{table_name}_date",
                    f"""
                    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_{table_name}_date
                    ON {table_name} (dealyear DESC, dealmonth DESC, dealday DESC)
                    """,
                    "거래일자 인덱스 (최신순 정렬)"
                )
            ]

            for idx_name, create_sql, description in indexes_to_create:
                # 인덱스가 이미 존재하는지 확인
                index_exists = any(idx[0] == idx_name for idx in existing_indexes)

                if index_exists:
                    print(f"\n[OK] 인덱스 '{idx_name}' 이미 존재")
                    continue

                print(f"\n인덱스 생성 중: {idx_name}")
                print(f"  설명: {description}")

                start_time = time.time()

                try:
                    cursor.execute(create_sql)

                    elapsed = time.time() - start_time
                    print(f"  [OK] 생성 완료! (소요 시간: {elapsed:.1f}초)")

                    # 인덱스 크기 확인
                    cursor.execute(f"""
                        SELECT pg_size_pretty(pg_relation_size('{idx_name}'::regclass)) as index_size
                    """)
                    size_result = cursor.fetchone()
                    if size_result:
                        print(f"  인덱스 크기: {size_result[0]}")

                except Exception as e:
                    print(f"  [ERROR] 생성 실패: {e}")
                    continue

            # 테이블 통계 업데이트
            print(f"\n{table_name} 테이블 통계 업데이트 중...")
            cursor.execute(f"ANALYZE {table_name}")
            print("[OK] 통계 업데이트 완료!")

        print("\n" + "="*60)
        print("모든 인덱스 생성 작업이 완료되었습니다!")
        print("="*60)
        print("\n검색 쿼리가 훨씬 빠르게 실행될 것입니다.")

    except Exception as e:
        print(f"\n오류 발생: {e}")
        raise
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    print("="*60)
    print("거래 데이터 테이블 인덱스 생성")
    print("="*60)
    print("\n이 스크립트는 다음 테이블에 인덱스를 생성합니다:")
    print("  - apt_rent_transactions (아파트)")
    print("  - villa_rent_transactions (연립다세대)")
    print("  - officetel_rent_transactions (오피스텔)")
    print("  - dagagu_rent_transactions (단독다가구)")
    print("\nCONCURRENTLY 옵션을 사용하여 서비스 중단 없이 생성됩니다.")
    print("시간이 다소 걸릴 수 있습니다 (테이블 크기에 따라 5-30분).")

    response = input("\n계속하시겠습니까? (y/n): ")
    if response.lower() != 'y':
        print("취소되었습니다.")
        exit(0)

    print()
    create_transaction_indexes()
