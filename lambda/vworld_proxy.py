import json
import urllib.request
import urllib.parse
from urllib.error import HTTPError, URLError

def lambda_handler(event, context):
    """
    VWorld API 프록시 Lambda 함수
    Seoul 리전에서 실행되어 VWorld API 호출
    """

    # CORS 헤더
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json'
    }

    # OPTIONS 요청 처리 (CORS preflight)
    if event.get('httpMethod') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': headers,
            'body': ''
        }

    try:
        # 쿼리 파라미터에서 필요한 값 추출
        params = event.get('queryStringParameters', {})

        pnu = params.get('pnu')
        api_key = params.get('key')
        domain = params.get('domain')

        if not pnu or not api_key or not domain:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({
                    'error': 'Missing required parameters: pnu, key, domain'
                })
            }

        # VWorld API URL 구성 (URL 인코딩 없이)
        vworld_url = f"https://api.vworld.kr/ned/data/getPossessionAttr?pnu={pnu}&format=xml&numOfRows=1000&pageNo=1&key={api_key}&domain={domain}"

        print(f"[Lambda] Calling VWorld API: {vworld_url.replace(api_key, api_key[:5] + '***')}")

        # VWorld API 호출
        req = urllib.request.Request(
            vworld_url,
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        )

        with urllib.request.urlopen(req, timeout=30) as response:
            response_data = response.read().decode('utf-8')
            status_code = response.status

            print(f"[Lambda] VWorld API response status: {status_code}")

            return {
                'statusCode': status_code,
                'headers': {
                    **headers,
                    'Content-Type': 'application/xml; charset=utf-8'
                },
                'body': response_data
            }

    except HTTPError as e:
        error_body = e.read().decode('utf-8')
        print(f"[Lambda] HTTPError: {e.code} - {error_body}")

        return {
            'statusCode': e.code,
            'headers': headers,
            'body': json.dumps({
                'error': f'VWorld API HTTPError: {e.code}',
                'details': error_body
            })
        }

    except URLError as e:
        print(f"[Lambda] URLError: {str(e)}")

        return {
            'statusCode': 502,
            'headers': headers,
            'body': json.dumps({
                'error': 'VWorld API connection failed',
                'details': str(e)
            })
        }

    except Exception as e:
        print(f"[Lambda] Unexpected error: {str(e)}")

        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({
                'error': 'Internal server error',
                'details': str(e)
            })
        }
