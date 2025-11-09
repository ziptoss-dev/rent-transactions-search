// 무한 스크롤 + 성능 최적화 버전
let currentPage = 1;
let isLoading = false;
let hasMoreData = true;
let currentFilters = null;
let totalCount = 0;

// 모달 무한 스크롤 상태
let modalCurrentPage = 1;
let modalIsLoading = false;
let modalHasMoreData = true;
let modalCurrentBuilding = null; // {buildingName, propertyType, sigunguCode, umdName, jibun, sido, sigungu}
let modalAllData = []; // 필터링 전 전체 데이터 저장

// DOM 요소 캐싱 (성능 최적화 1: 중복 DOM 조회 제거)
const cachedElements = {};

// Debounce 유틸리티 함수 (성능 최적화 4)
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// 보증금/월세 포맷 함수 (만원 단위 → 억/만원 표시)
function formatPrice(value) {
    // 값이 없으면 빈 문자열 반환
    if (!value && value !== 0 && value !== '0') return '';

    // 쉼표 제거하고 숫자로 변환
    const num = parseInt(String(value).replace(/,/g, ''));
    if (isNaN(num)) return '';

    // 0이면 "0" 반환
    if (num === 0) return '0';

    const eok = Math.floor(num / 10000); // 억 단위
    const man = num % 10000; // 만원 단위

    if (eok > 0 && man > 0) {
        // 억과 만원 둘 다 있는 경우: "1억 4,000"
        return `${eok}억 ${man.toLocaleString()}`;
    } else if (eok > 0) {
        // 억 단위만 있는 경우: "12억"
        return `${eok}억`;
    } else {
        // 만원 단위만 있는 경우: "8,000"
        return man.toLocaleString();
    }
}

// 오피스텔 보증금 포맷 (기준시가 기반 색상 + 툴팁)
function formatDepositWithStandardPrice(row) {
    const depositValue = formatPrice(row.보증금);
    if (!depositValue) return '';

    // 기준시가 데이터가 없으면 일반 포맷으로 반환
    if (!row.기준시가_126퍼센트) {
        return depositValue;
    }

    // 보증금 (만원) 값을 원 단위로 변환
    const depositNum = parseInt(String(row.보증금).replace(/,/g, '')) * 10000; // 만원 -> 원
    const threshold = parseFloat(row.기준시가_126퍼센트);

    // 126% 기준으로 색상 결정
    const isWithinThreshold = depositNum <= threshold;
    const color = isWithinThreshold ? '#10b981' : '#ef4444'; // green : red

    // 툴팁 내용 생성 (HTML 형식)
    const unitPrice = parseFloat(row.기준시가_면적당가격 || 0);
    const exclusiveArea = parseFloat(row.기준시가_전용면적 || 0);
    const sharedArea = parseFloat(row.기준시가_공유면적 || 0);
    const totalArea = parseFloat(row.기준시가_면적계 || 0);
    const standardPrice = parseFloat(row.기준시가_총액 || 0);

    const tooltipContent = `
        면적당 기준시가: ${unitPrice.toLocaleString()}원/㎡<br>
        전용면적: ${exclusiveArea.toFixed(2)}㎡<br>
        공유면적: ${sharedArea.toFixed(2)}㎡<br>
        면적 계: ${totalArea.toFixed(2)}㎡<br>
        기준시가: ${formatPrice(Math.round(standardPrice / 10000))}<br>
        기준시가의 126%: ${formatPrice(Math.round(threshold / 10000))}
    `;

    return `<span class="deposit-with-standard-price" style="color: ${color}; font-weight: 600;" data-tooltip-html="${tooltipContent.trim()}">${depositValue}</span>`;
}

// 아파트/연립다세대 보증금 포맷 (공동주택가격 기반 색상 + 툴팁)
function formatDepositWithApartmentPrice(row) {
    const depositValue = formatPrice(row.보증금);
    if (!depositValue) return '';

    // 공동주택가격 데이터가 없으면 일반 포맷으로 반환
    if (!row.공동주택가격_126퍼센트) {
        return depositValue;
    }

    // 보증금 (만원) 값을 원 단위로 변환
    const depositNum = parseInt(String(row.보증금).replace(/,/g, '')) * 10000; // 만원 -> 원
    const threshold = parseFloat(row.공동주택가격_126퍼센트);

    // 126% 기준으로 색상 결정
    const isWithinThreshold = depositNum <= threshold;
    const color = isWithinThreshold ? '#10b981' : '#ef4444'; // green : red

    // 툴팁 내용 생성 (HTML 형식)
    const aptPrice = parseFloat(row.공동주택가격 || 0);
    const tooltipContent = `
        공동주택가격: ${formatPrice(Math.round(aptPrice / 10000))}<br>
        공동주택가격의 126%: ${formatPrice(Math.round(threshold / 10000))}
    `;

    return `<span class="deposit-with-apartment-price" style="color: ${color}; font-weight: 600;" data-tooltip-html="${tooltipContent.trim()}">${depositValue}</span>`;
}

// 호실 정보 포맷 함수 (툴팁 지원)
function formatUnitInfo(row) {
    const unitStr = row.동호명;

    // 호실 정보가 아직 로드되지 않은 경우 (null 또는 undefined)
    if (unitStr === null || unitStr === undefined) {
        // 단독다가구 제외하고 모두 호실 확인 버튼 표시
        if (row.구분 !== '단독다가구') {
            return `
                <button class="unit-check-btn"
                    data-sgg-code="${row.시군구코드 || ''}"
                    data-umd-name="${row.읍면동리 || ''}"
                    data-jibun="${row.지번 || ''}"
                    data-floor="${row.층 || ''}"
                    data-area="${row.면적 || ''}">
                    호실 확인
                </button>
            `;
        }
        return '-';
    }

    // '-'인 경우 그대로 반환
    if (unitStr === '-') {
        return '-';
    }

    // 전체 목록이 있으면 항상 툴팁 추가 (has_more 여부와 상관없이)
    if (row.동호명_전체목록 && row.동호명_전체목록.length > 0) {
        const tooltipText = row.동호명_전체목록.join(', ');
        return `<span class="unit-with-tooltip" title="${tooltipText}">${unitStr}</span>`;
    }

    // 쉼표가 포함된 경우 (여러 호실) 툴팁 추가
    if (unitStr.includes(',')) {
        return `<span class="unit-with-tooltip" title="${unitStr}">${unitStr}</span>`;
    }

    // 일반 텍스트 반환
    return unitStr;
}

// DOM 요소 초기화 및 캐싱
function initCachedElements() {
    cachedElements.sido = document.getElementById('sido');
    cachedElements.sigunguCheckboxes = document.getElementById('sigungu-checkboxes');
    cachedElements.umdCheckboxes = document.getElementById('umd-checkboxes');
    cachedElements.resultCount = document.getElementById('result-count');
    cachedElements.includeApt = document.getElementById('include-apt');
    cachedElements.includeVilla = document.getElementById('include-villa');
    cachedElements.includeDagagu = document.getElementById('include-dagagu');
    cachedElements.includeOfficetel = document.getElementById('include-officetel');
    cachedElements.contractEnd = document.getElementById('contract-end');
    cachedElements.areaMin = document.getElementById('area-min');
    cachedElements.areaMax = document.getElementById('area-max');
    cachedElements.depositMin = document.getElementById('deposit-min');
    cachedElements.depositMax = document.getElementById('deposit-max');
    cachedElements.rentMin = document.getElementById('rent-min');
    cachedElements.rentMax = document.getElementById('rent-max');
    cachedElements.buildYearMin = document.getElementById('build-year-min');
    cachedElements.buildYearMax = document.getElementById('build-year-max');
}

// 계약만기시기 드롭다운 옵션 생성 (현재 월부터 24개월)
function populateContractEndOptions() {
    const contractEndSelect = document.getElementById('contract-end');
    if (!contractEndSelect) return;

    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1; // 0-11 -> 1-12

    // 기존 옵션 유지하고 새 옵션만 추가
    const fragment = document.createDocumentFragment();

    // 현재 월부터 24개월 동안 옵션 생성
    for (let i = 0; i < 24; i++) {
        const targetDate = new Date(currentYear, currentMonth - 1 + i, 1);
        const year = targetDate.getFullYear();
        const month = targetDate.getMonth() + 1;

        const yearMonth = `${year}${month.toString().padStart(2, '0')}`;
        const displayText = `${year}년 ${month}월`;

        const option = document.createElement('option');
        option.value = yearMonth;
        option.textContent = displayText;
        fragment.appendChild(option);
    }

    contractEndSelect.appendChild(fragment);
}

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', function() {
    initCachedElements();
    loadSidos();
    populateContractEndOptions();
    setupInfiniteScroll();
    initBuildingSearch();

    // 검색 버튼 이벤트 리스너
    const searchBtn = document.getElementById('search-btn');
    if (searchBtn) {
        searchBtn.addEventListener('click', () => searchTransactions(false));
    }

    // 초기화 버튼 이벤트 리스너
    const resetBtn = document.getElementById('reset-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetFilters);
    }

    // 호실 확인 버튼 이벤트 리스너 (이벤트 위임)
    const resultsTable = document.getElementById('results-table');
    if (resultsTable) {
        resultsTable.addEventListener('click', async function(e) {
            const btn = e.target.closest('.unit-check-btn');
            if (!btn) return;

            const sggCode = btn.dataset.sggCode;
            const umdName = btn.dataset.umdName;
            const jibun = btn.dataset.jibun;
            const floor = btn.dataset.floor;
            const area = btn.dataset.area;

            // 버튼 비활성화 및 로딩 표시
            btn.disabled = true;
            btn.textContent = '조회중...';

            try {
                const response = await fetch('/api/fetch-unit-info', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        sgg_code: sggCode,
                        umd_name: umdName,
                        jibun: jibun,
                        floor: floor,
                        area: area
                    })
                });

                const data = await response.json();

                if (data.success) {
                    // 호실 정보 표시
                    const cell = btn.closest('td');
                    if (data.all_units && data.all_units.length > 0) {
                        const tooltipText = data.all_units.join(', ');
                        cell.innerHTML = `<span class="unit-with-tooltip" title="${tooltipText}">${data.unit || '-'}</span>`;
                    } else {
                        cell.textContent = data.unit || '-';
                    }
                } else {
                    btn.textContent = '조회 실패';
                    setTimeout(() => {
                        btn.textContent = '호실 확인';
                        btn.disabled = false;
                    }, 2000);
                }
            } catch (error) {
                console.error('호실 정보 조회 오류:', error);
                btn.textContent = '오류';
                setTimeout(() => {
                    btn.textContent = '호실 확인';
                    btn.disabled = false;
                }, 2000);
            }
        });
    }
});

// 무한 스크롤 설정 (성능 최적화 4: debounce 적용)
let scrollHandler = null;  // 전역 변수로 핸들러 저장

function setupInfiniteScroll() {
    const tableContainer = document.querySelector('.table-container');
    if (tableContainer) {
        console.log('[무한스크롤] 설정 시도', {
            scrollTop: tableContainer.scrollTop,
            clientHeight: tableContainer.clientHeight,
            scrollHeight: tableContainer.scrollHeight,
            isScrollable: tableContainer.scrollHeight > tableContainer.clientHeight
        });

        // 기존 이벤트 리스너 제거
        if (scrollHandler) {
            tableContainer.removeEventListener('scroll', scrollHandler);
            console.log('[무한스크롤] 기존 리스너 제거');
        }

        scrollHandler = debounce(() => {
            const scrollTop = tableContainer.scrollTop;
            const clientHeight = tableContainer.clientHeight;
            const scrollHeight = tableContainer.scrollHeight;
            const isNearBottom = scrollTop + clientHeight >= scrollHeight - 100;

            console.log('[무한스크롤] 스크롤 이벤트:', {
                scrollTop,
                clientHeight,
                scrollHeight,
                isNearBottom,
                isLoading,
                hasMoreData,
                hasFilters: !!currentFilters
            });

            if (isNearBottom) {
                if (!isLoading && hasMoreData && currentFilters) {
                    console.log('[무한스크롤] 추가 데이터 로드 시작');
                    loadMoreData();
                } else {
                    console.log('[무한스크롤] 로드 안 함:', {
                        isLoading,
                        hasMoreData,
                        hasFilters: !!currentFilters
                    });
                }
            }
        }, 150);

        tableContainer.addEventListener('scroll', scrollHandler);
        console.log('[무한스크롤] 새 리스너 등록 완료');
    } else {
        console.error('[무한스크롤] table-container를 찾을 수 없음');
    }
}

// 더 많은 데이터 로드
function loadMoreData() {
    if (isLoading || !hasMoreData) {
        console.log('[무한스크롤] loadMoreData 중단:', { isLoading, hasMoreData });
        return;
    }

    console.log('[무한스크롤] 페이지 증가:', currentPage, '->', currentPage + 1);
    currentPage++;

    // 로딩 바 표시
    showLoadingIndicator();

    searchTransactions(true); // append 모드
}

// 로딩 인디케이터 표시
function showLoadingIndicator() {
    // 기존 로딩 인디케이터 제거
    const existingIndicator = document.getElementById('loading-more');
    if (existingIndicator) {
        existingIndicator.remove();
    }

    // 새 로딩 인디케이터 추가
    const tableContainer = document.querySelector('.table-container');
    if (tableContainer) {
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'loading-more';
        loadingDiv.className = 'loading-more';
        loadingDiv.style.cssText = 'text-align: center; padding: 20px; color: #666; font-size: 14px;';
        loadingDiv.innerHTML = '<div class="spinner"></div><p>더 많은 데이터를 불러오는 중...</p>';
        tableContainer.appendChild(loadingDiv);
        console.log('[무한스크롤] 로딩 인디케이터 표시');
    }
}

// 시도 목록 로드 (성능 최적화 2: 이벤트 리스너 중복 제거)
function loadSidos() {
    fetch('/api/locations/sido')
        .then(response => response.json())
        .then(data => {
            const sidoSelect = cachedElements.sido;
            sidoSelect.innerHTML = '<option value="">전체</option>';

            // DocumentFragment 사용 (성능 최적화 5)
            const fragment = document.createDocumentFragment();

            data.sidos.forEach(sido => {
                const option = document.createElement('option');
                option.value = sido;
                option.textContent = sido;
                fragment.appendChild(option);
            });

            sidoSelect.appendChild(fragment);

            // 이벤트 리스너는 한 번만 등록
            sidoSelect.removeEventListener('change', loadSigungus);
            sidoSelect.addEventListener('change', loadSigungus);
        })
        .catch(error => {
            console.error('Error loading sidos:', error);
        });
}

// 시군구 목록 로드 (성능 최적화 2, 5: 이벤트 리스너 최적화 + DocumentFragment)
function loadSigungus() {
    const sido = cachedElements.sido ? cachedElements.sido.value : document.getElementById('sido').value;
    const container = cachedElements.sigunguCheckboxes || document.getElementById('sigungu-checkboxes');

    if (!sido) {
        container.innerHTML = '<div class="placeholder-text">시도를 먼저 선택해주세요</div>';
        clearUmds();
        return;
    }

    fetch(`/api/locations/sigungu?sido=${encodeURIComponent(sido)}`)
        .then(response => response.json())
        .then(data => {
            console.log('Sigungu data:', data);  // 디버깅용
            container.innerHTML = '';

            // 전체 선택/해제 버튼
            const controls = document.createElement('div');
            controls.className = 'sigungu-group';
            controls.innerHTML = `
                <div class="sigungu-group-header">
                    <span>시군구 선택</span>
                    <div class="sigungu-controls">
                        <button type="button" class="control-btn" onclick="toggleAllSigungus(true)">전체선택</button>
                        <button type="button" class="control-btn secondary" onclick="toggleAllSigungus(false)">전체해제</button>
                    </div>
                </div>
            `;
            container.appendChild(controls);

            // DocumentFragment 사용 (성능 최적화 5)
            const fragment = document.createDocumentFragment();

            if (data.sigungus && data.sigungus.length > 0) {
                data.sigungus.forEach(sigungu => {
                    const label = document.createElement('label');
                    label.className = 'checkbox-label';
                    label.innerHTML = `
                        <input type="checkbox" name="sigungu" value="${sigungu}">
                        ${sigungu}
                    `;
                    fragment.appendChild(label);
                });
                container.appendChild(fragment);
            } else {
                container.innerHTML += '<div class="placeholder-text">시군구 데이터가 없습니다</div>';
            }

            // 이벤트 리스너 중복 제거 (성능 최적화 2)
            container.removeEventListener('change', loadUmds);
            container.addEventListener('change', loadUmds);
        })
        .catch(error => {
            console.error('Error loading sigungus:', error);
            container.innerHTML = '<div class="placeholder-text">시군구 로드 중 오류가 발생했습니다</div>';
        });
}

// 읍면동 목록 로드 (성능 최적화 5: DocumentFragment 사용)
function loadUmds() {
    const sido = cachedElements.sido ? cachedElements.sido.value : document.getElementById('sido').value;
    const selectedSigungus = Array.from(document.querySelectorAll('input[name="sigungu"]:checked')).map(cb => cb.value);
    const container = cachedElements.umdCheckboxes || document.getElementById('umd-checkboxes');

    if (!sido || selectedSigungus.length === 0) {
        container.innerHTML = '<div class="placeholder-text">시군구를 먼저 선택해주세요</div>';
        return;
    }

    const params = new URLSearchParams();
    params.append('sido', sido);
    selectedSigungus.forEach(sigungu => params.append('sigungu', sigungu));

    fetch(`/api/locations/umd?${params.toString()}`)
        .then(response => response.json())
        .then(data => {
            container.innerHTML = '';

            // 전체 선택/해제 버튼
            const controls = document.createElement('div');
            controls.className = 'sigungu-group';
            controls.innerHTML = `
                <div class="sigungu-group-header">
                    <span>읍면동 선택</span>
                    <div class="sigungu-controls">
                        <button type="button" class="control-btn" onclick="toggleAllUmds(true)">전체선택</button>
                        <button type="button" class="control-btn secondary" onclick="toggleAllUmds(false)">전체해제</button>
                    </div>
                </div>
            `;
            container.appendChild(controls);

            // DocumentFragment 사용 (성능 최적화 5)
            const fragment = document.createDocumentFragment();

            // 시군구별로 그룹화
            Object.entries(data.umds).forEach(([sigungu, umds]) => {
                if (umds.length > 0) {
                    const groupDiv = document.createElement('div');
                    groupDiv.className = 'umd-checkboxes';

                    umds.forEach(umd => {
                        const label = document.createElement('label');
                        label.className = 'checkbox-label';
                        label.innerHTML = `
                            <input type="checkbox" name="umd" value="${umd}" checked>
                            ${umd}
                        `;
                        groupDiv.appendChild(label);
                    });

                    fragment.appendChild(groupDiv);
                }
            });

            container.appendChild(fragment);
        })
        .catch(error => {
            console.error('Error loading umds:', error);
            container.innerHTML = '<div class="placeholder-text">읍면동 로드 중 오류가 발생했습니다</div>';
        });
}

// 시군구 전체 선택/해제
function toggleAllSigungus(selectAll) {
    const checkboxes = document.querySelectorAll('input[name="sigungu"]');
    checkboxes.forEach(cb => cb.checked = selectAll);
    loadUmds();
}

// 읍면동 전체 선택/해제
function toggleAllUmds(selectAll) {
    const checkboxes = document.querySelectorAll('input[name="umd"]');
    checkboxes.forEach(cb => cb.checked = selectAll);
}

// 읍면동 초기화
function clearUmds() {
    const container = cachedElements.umdCheckboxes || document.getElementById('umd-checkboxes');
    if (container) {
        container.innerHTML = '<div class="placeholder-text">시군구를 먼저 선택해주세요</div>';
    }
}

// 검색 함수
function searchTransactions(append = false) {
    if (isLoading) return;

    // 필수값 검증 (새 검색일 때만)
    if (!append) {
        const contractEnd = cachedElements.contractEnd.value.trim();
        const selectedSigungus = Array.from(document.querySelectorAll('input[name="sigungu"]:checked')).map(cb => cb.value);

        if (!contractEnd) {
            alert('계약만기시기를 선택해주세요.');
            return;
        }

        if (selectedSigungus.length === 0) {
            alert('최소 1개 이상의 시군구를 선택해주세요.');
            return;
        }
    }

    // 새로운 검색인 경우 초기화
    if (!append) {
        currentPage = 1;
        hasMoreData = true;
        totalCount = 0;
    }

    isLoading = true;

    // 필터 수집 (캐싱된 요소 사용)
    const filters = {
        include_apt: cachedElements.includeApt.checked,
        include_villa: cachedElements.includeVilla.checked,
        include_dagagu: cachedElements.includeDagagu.checked,
        include_officetel: cachedElements.includeOfficetel.checked,
        contract_end: cachedElements.contractEnd.value.trim(),
        sido: cachedElements.sido.value,
        sigungu: Array.from(document.querySelectorAll('input[name="sigungu"]:checked')).map(cb => cb.value),
        umd: Array.from(document.querySelectorAll('input[name="umd"]:checked')).map(cb => cb.value),
        area_min: cachedElements.areaMin.value,
        area_max: cachedElements.areaMax.value,
        deposit_min: cachedElements.depositMin.value,
        deposit_max: cachedElements.depositMax.value,
        rent_min: cachedElements.rentMin.value,
        rent_max: cachedElements.rentMax.value,
        build_year_min: cachedElements.buildYearMin.value,
        build_year_max: cachedElements.buildYearMax.value,
        page: currentPage,
        page_size: 20
    };

    currentFilters = filters;

    // 로딩 표시 (성능 최적화 8: 로딩 상태 개선)
    const loadingEl = document.getElementById('loading');
    const errorEl = document.getElementById('error-message');

    if (!append) {
        if (loadingEl) loadingEl.style.display = 'block';
        if (errorEl) errorEl.style.display = 'none';
    }
    // append 모드에서는 showLoadingIndicator()가 이미 호출됨

    fetch('/api/search', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(filters)
    })
    .then(response => response.json())
    .then(data => {
        console.log('[무한스크롤] 응답 받음:', {
            success: data.success,
            count: data.count,
            has_more: data.has_more,
            append: append
        });

        if (data.success) {
            displayResults(data, append);

            // 페이지네이션 정보 업데이트
            hasMoreData = data.has_more || false;
            console.log('[무한스크롤] hasMoreData 업데이트:', hasMoreData);

            if (!append) {
                totalCount = data.count;
            } else {
                totalCount += data.count;
            }

            updateResultCount();
        } else {
            throw new Error(data.error || '검색 중 오류가 발생했습니다.');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        const loadingEl = document.getElementById('loading');
        const errorEl = document.getElementById('error-message');

        if (!append) {
            if (loadingEl) loadingEl.style.display = 'none';
            if (errorEl) {
                errorEl.textContent = `오류: ${error.message}`;
                errorEl.style.display = 'block';
            }
        }
    })
    .finally(() => {
        isLoading = false;
        console.log('[무한스크롤] isLoading = false');

        const loadingEl = document.getElementById('loading');
        if (loadingEl) loadingEl.style.display = 'none';

        // 로딩 표시 제거
        const loadingMore = document.getElementById('loading-more');
        if (loadingMore) {
            loadingMore.remove();
            console.log('[무한스크롤] 로딩 인디케이터 제거');
        }
    });
}

// 결과 표시 (성능 최적화 5: DocumentFragment 사용)
function displayResults(data, append = false) {
    // 로딩 숨기기
    const loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.style.display = 'none';

    if (!data.data || data.data.length === 0) {
        if (!append) {
            const tbody = document.querySelector('.table-container tbody');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="19" class="no-data">검색 조건에 맞는 데이터가 없습니다.</td></tr>';
            }
        }
        hasMoreData = false;
        return;
    }

    // 데이터 행 추가 (성능 최적화 5: DocumentFragment 사용)
    const tbody = append ? document.querySelector('#results-table tbody') : null;

    if (append && tbody) {
        // DocumentFragment로 한 번에 추가
        const fragment = document.createDocumentFragment();

        data.data.forEach(row => {
            const tr = document.createElement('tr');
            const badgeClass = getBadgeClass(row.구분);

            // 보증금 포맷 선택: 오피스텔은 기준시가, 아파트/연립다세대는 공동주택가격
            let depositHTML;
            if (row.구분 === '오피스텔') {
                depositHTML = formatDepositWithStandardPrice(row);
            } else if (row.구분 === '아파트' || row.구분 === '연립다세대') {
                depositHTML = formatDepositWithApartmentPrice(row);
            } else {
                depositHTML = formatPrice(row.보증금);
            }

            tr.innerHTML = `
                <td><span class="badge ${badgeClass}">${row.구분}</span></td>
                <td>${row.시도 || ''}</td>
                <td>${row.시군구 || ''}</td>
                <td>${row.읍면동리 || ''}</td>
                <td>${row.지번 || ''}</td>
                <td class="unit-info-cell">${formatUnitInfo(row)}</td>
                <td><span class="building-name-clickable" data-building-name="${row.단지명 || row.건물명 || ''}" data-property-type="${row.구분 || ''}" data-sigungu-code="${row.시군구코드 || ''}" data-umd-name="${row.읍면동리 || ''}" data-jibun="${row.지번 || ''}" data-sido="${row.시도 || ''}" data-sigungu="${row.시군구 || ''}">${row.단지명 || row.건물명 || ''}</span></td>
                <td>${row.층 || ''}</td>
                <td>${row.면적 || ''}</td>
                <td>${getContractTypeBadge(row.월세)}</td>
                <td>${depositHTML}</td>
                <td>${formatPrice(row.월세)}</td>
                <td>${row.계약년월 || ''}</td>
                <td>${row.계약일 || ''}</td>
                <td>${row.건축년도 || ''}</td>
                <td>${row.계약구분 || ''}</td>
                <td>${getContractPeriodWithBadge(row.계약기간)}</td>
                <td>${formatPrice(row.종전계약보증금)}</td>
                <td>${formatPrice(row.종전계약월세)}</td>
                <td>${row.갱신요구권사용 || ''}</td>
            `;

            fragment.appendChild(tr);
        });

        tbody.appendChild(fragment);
    } else {
        // 새 검색 - tbody만 업데이트
        const tbody = document.querySelector('#results-table tbody');
        if (tbody) {
            let rowsHTML = '';

            data.data.forEach(row => {
                const badgeClass = getBadgeClass(row.구분);

                // 보증금 포맷 선택: 오피스텔은 기준시가, 아파트/연립다세대는 공동주택가격
                let depositHTML;
                if (row.구분 === '오피스텔') {
                    depositHTML = formatDepositWithStandardPrice(row);
                } else if (row.구분 === '아파트' || row.구분 === '연립다세대') {
                    depositHTML = formatDepositWithApartmentPrice(row);
                } else {
                    depositHTML = formatPrice(row.보증금);
                }

                rowsHTML += `
                    <tr>
                        <td><span class="badge ${badgeClass}">${row.구분}</span></td>
                        <td>${row.시도 || ''}</td>
                        <td>${row.시군구 || ''}</td>
                        <td>${row.읍면동리 || ''}</td>
                        <td>${row.지번 || ''}</td>
                        <td class="unit-info-cell">${formatUnitInfo(row)}</td>
                        <td><span class="building-name-clickable" data-building-name="${row.단지명 || row.건물명 || ''}" data-property-type="${row.구분 || ''}" data-sigungu-code="${row.시군구코드 || ''}" data-umd-name="${row.읍면동리 || ''}" data-jibun="${row.지번 || ''}" data-sido="${row.시도 || ''}" data-sigungu="${row.시군구 || ''}">${row.단지명 || row.건물명 || ''}</span></td>
                        <td>${row.층 || ''}</td>
                        <td>${row.면적 || ''}</td>
                        <td>${getContractTypeBadge(row.월세)}</td>
                        <td>${depositHTML}</td>
                        <td>${formatPrice(row.월세)}</td>
                        <td>${row.계약년월 || ''}</td>
                        <td>${row.계약일 || ''}</td>
                        <td>${row.건축년도 || ''}</td>
                        <td>${row.계약구분 || ''}</td>
                        <td>${getContractPeriodWithBadge(row.계약기간)}</td>
                        <td>${formatPrice(row.종전계약보증금)}</td>
                        <td>${formatPrice(row.종전계약월세)}</td>
                        <td>${row.갱신요구권사용 || ''}</td>
                    </tr>
                `;
            });

            tbody.innerHTML = rowsHTML;
        }

        // 무한 스크롤 다시 설정
        setupInfiniteScroll();
    }
}

// 배지 클래스 결정
function getBadgeClass(type) {
    switch(type) {
        case '아파트': return 'badge-apt';
        case '연립다세대': return 'badge-villa';
        case '단독다가구': return 'badge-dagagu';
        case '오피스텔': return 'badge-officetel';
        default: return 'badge-apt';
    }
}

// 전월세 구분 판단 (월세가 0이거나 없으면 전세, 있으면 월세)
function getContractTypeBadge(monthlyRent) {
    const rent = parseInt(String(monthlyRent || '0').replace(/,/g, ''));
    if (rent === 0 || isNaN(rent)) {
        return '<span class="badge badge-jeonse">전세</span>';
    } else {
        return '<span class="badge badge-wolse">월세</span>';
    }
}

// 계약기간에서 기간 뱃지 생성
function getContractPeriodWithBadge(contractTerm) {
    if (!contractTerm || contractTerm === '-' || contractTerm === '') {
        return '';
    }

    const parts = contractTerm.split('~');
    if (parts.length !== 2) {
        return contractTerm;
    }

    const start = parts[0].trim();
    const end = parts[1].trim();

    let startYear, startMonth, endYear, endMonth;

    // YYYYMM 형식 (단독다가구)
    if (start.length === 6 && !start.includes('.')) {
        startYear = parseInt(start.substring(0, 4));
        startMonth = parseInt(start.substring(4, 6));
        endYear = parseInt(end.substring(0, 4));
        endMonth = parseInt(end.substring(4, 6));
    }
    // YY.MM 형식 (아파트, 연립다세대, 오피스텔)
    else if (start.includes('.')) {
        const startParts = start.split('.');
        const endParts = end.split('.');
        startYear = parseInt('20' + startParts[0]);
        startMonth = parseInt(startParts[1]);
        endYear = parseInt('20' + endParts[0]);
        endMonth = parseInt(endParts[1]);
    } else {
        return contractTerm;
    }

    // 월 차이 계산
    const monthsDiff = (endYear - startYear) * 12 + (endMonth - startMonth);

    let periodText = '';
    if (monthsDiff >= 11 && monthsDiff <= 12) {
        periodText = '1년';
    } else if (monthsDiff >= 23 && monthsDiff <= 24) {
        periodText = '2년';
    } else {
        periodText = `${monthsDiff}개월`;
    }

    return `<span class="badge badge-period">${periodText}</span>${contractTerm}`;
}

// 결과 카운트 업데이트
function updateResultCount() {
    const countElement = cachedElements.resultCount;
    if (totalCount > 0) {
        const moreText = hasMoreData ? ' (더 많은 데이터 로드 중...)' : '';
        countElement.textContent = `총 ${totalCount.toLocaleString()}건${moreText}`;
    } else {
        countElement.textContent = '검색 결과가 없습니다';
    }
}

// 필터 초기화
function resetFilters() {
    // 체크박스 초기화
    cachedElements.includeApt.checked = true;
    cachedElements.includeVilla.checked = true;
    cachedElements.includeDagagu.checked = true;
    cachedElements.includeOfficetel.checked = true;

    // 드롭다운 초기화
    cachedElements.sido.value = '';
    cachedElements.contractEnd.value = '';

    // 입력 필드 초기화
    cachedElements.areaMin.value = '';
    cachedElements.areaMax.value = '';
    cachedElements.depositMin.value = '';
    cachedElements.depositMax.value = '';
    cachedElements.rentMin.value = '';
    cachedElements.rentMax.value = '';
    cachedElements.buildYearMin.value = '';
    cachedElements.buildYearMax.value = '';

    // 시군구, 읍면동 초기화
    cachedElements.sigunguCheckboxes.innerHTML = '<div class="placeholder-text">시도를 먼저 선택해주세요</div>';
    clearUmds();

    // 결과 초기화
    const tbody = document.querySelector('#results-table tbody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="19" class="no-data">검색 조건을 설정하고 검색 버튼을 눌러주세요.</td></tr>';
    }
    cachedElements.resultCount.textContent = '0건';

    // 페이지네이션 초기화
    currentPage = 1;
    hasMoreData = true;
    currentFilters = null;
    totalCount = 0;
}

// ============ 건물별 실거래가 모달 기능 ============

// 계약기간에서 종료 월 추출 (YYYYMM 형식으로 반환)
function parseContractEndMonth(contractTerm) {
    if (!contractTerm || contractTerm === '-' || contractTerm === '') {
        return null;
    }

    const parts = contractTerm.split('~');
    if (parts.length !== 2) {
        return null;
    }

    const end = parts[1].trim();

    // YYYYMM 형식 (단독다가구) - 예: "202501"
    if (end.length === 6 && !end.includes('.')) {
        return end;
    }

    // YY.MM 형식 (아파트, 연립다세대, 오피스텔) - 예: "25.01"
    if (end.includes('.')) {
        const endParts = end.split('.');
        if (endParts.length === 2) {
            const year = '20' + endParts[0];
            const month = endParts[1].padStart(2, '0');
            return year + month;
        }
    }

    return null;
}

// 현재 월 (YYYYMM 형식)
function getCurrentYearMonth() {
    const today = new Date();
    const year = today.getFullYear();
    const month = (today.getMonth() + 1).toString().padStart(2, '0');
    return year + month;
}

// 모달 데이터 필터링 및 정렬
function filterAndSortModalData(data, showFutureOnly) {
    if (!showFutureOnly) {
        // 필터링 안 함
        return data;
    }

    const currentMonth = getCurrentYearMonth();

    // 계약만기시기가 현재 월 이상인 것만 필터링
    const filtered = data.filter(row => {
        const endMonth = parseContractEndMonth(row.계약기간);
        if (!endMonth) return false;
        return endMonth >= currentMonth;
    });

    // 계약만기시기 오름차순 정렬 (가까운 미래 순)
    filtered.sort((a, b) => {
        const endA = parseContractEndMonth(a.계약기간) || '';
        const endB = parseContractEndMonth(b.계약기간) || '';
        return endA.localeCompare(endB);
    });

    return filtered;
}

// 건물명 클릭 이벤트 위임
document.addEventListener('click', function(e) {
    if (e.target && e.target.classList.contains('building-name-clickable')) {
        const buildingName = e.target.dataset.buildingName;
        const propertyType = e.target.dataset.propertyType;
        const sigunguCode = e.target.dataset.sigunguCode;
        const umdName = e.target.dataset.umdName;
        const jibun = e.target.dataset.jibun;
        const sido = e.target.dataset.sido;
        const sigungu = e.target.dataset.sigungu;

        openBuildingModal(buildingName, propertyType, sigunguCode, umdName, jibun, sido, sigungu);
    }
});

// 모달 열기
function openBuildingModal(buildingName, propertyType, sigunguCode, umdName, jibun, sido, sigungu) {
    const modal = document.getElementById('building-modal');
    const modalBuildingName = document.getElementById('modal-building-name');
    const modalLoading = document.getElementById('modal-loading');
    const modalError = document.getElementById('modal-error');

    // 모달 무한 스크롤 상태 초기화
    modalCurrentPage = 1;
    modalHasMoreData = true;
    modalIsLoading = false;
    modalAllData = []; // 필터링 전 전체 데이터 초기화
    modalCurrentBuilding = {
        buildingName,
        propertyType,
        sigunguCode,
        umdName,
        jibun,
        sido,
        sigungu
    };

    // 탭 기능을 위한 건물 정보 저장
    currentBuildingInfo = {
        buildingName,
        propertyType,
        sigunguCode,
        umdName,
        jibun,
        sido,
        sigungu
    };

    // 탭 초기화 (실거래가 탭 활성화)
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
        content.style.display = 'none';
    });
    const transactionsTab = document.querySelector('.tab-btn[data-tab="transactions"]');
    if (transactionsTab) transactionsTab.classList.add('active');
    const transactionsContent = document.getElementById('tab-transactions');
    if (transactionsContent) {
        transactionsContent.classList.add('active');
        transactionsContent.style.display = 'block';
    }

    // 소유자 정보 초기화
    const ownerContent = document.getElementById('owner-info-content');
    const ownerError = document.getElementById('owner-error');
    if (ownerContent) ownerContent.innerHTML = '';
    if (ownerError) ownerError.style.display = 'none';

    // 필터 체크박스 초기화 (체크 해제)
    const futureOnlyCheckbox = document.getElementById('future-listings-only');
    if (futureOnlyCheckbox) {
        futureOnlyCheckbox.checked = false;
    }

    // 주택 유형 뱃지 생성
    const typeBadgeColors = {
        '아파트': '#3b82f6',
        '연립다세대': '#10b981',
        '오피스텔': '#f59e0b',
        '단독다가구': '#8b5cf6'
    };
    const badgeColor = typeBadgeColors[propertyType] || '#6b7280';
    const typeBadge = `<span style="display: inline-block; background: ${badgeColor}; color: white; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; margin-right: 12px;">${propertyType}</span>`;

    // 모달 제목 설정 (주택 유형 뱃지 + 주소 + 건물명)
    const addressText = `${sido} ${sigungu} ${umdName} ${jibun}`;
    const fullText = buildingName ? `${addressText} ${buildingName}` : addressText;
    modalBuildingName.innerHTML = typeBadge + fullText;

    // 관페 바로가기 링크 설정
    const gwanpeLink = document.getElementById('gwanpe-link');
    if (gwanpeLink) {
        const searchQuery = `${umdName} ${jibun}`;
        const encodedQuery = encodeURIComponent(searchQuery);
        gwanpeLink.href = `https://ziptoss.com/v2/admin/buildings?search=${encodedQuery}`;
    }

    // 모달 표시
    modal.style.display = 'flex';

    // 이전 데이터 즉시 초기화 (로딩 중 이전 데이터가 보이지 않도록)
    const modalTableBody = document.querySelector('#modal-results-table tbody');
    modalTableBody.innerHTML = '<tr><td colspan="14" class="no-data">조회 중...</td></tr>';

    // 로딩 표시
    modalLoading.style.display = 'block';
    modalError.style.display = 'none';

    // 모달 무한 스크롤 설정
    setupModalInfiniteScroll();

    // API 호출 (첫 페이지)
    loadBuildingTransactions(false);
}

// 모달 거래내역 로드 (append 옵션 지원)
function loadBuildingTransactions(append = false) {
    if (modalIsLoading) return;

    modalIsLoading = true;

    const modalLoading = document.getElementById('modal-loading');
    const modalError = document.getElementById('modal-error');

    if (!append) {
        modalLoading.style.display = 'block';
        modalError.style.display = 'none';
    }

    console.log('[모달무한스크롤] API 호출:', {
        page: modalCurrentPage,
        append: append
    });

    fetch('/api/building-transactions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            building_name: modalCurrentBuilding.buildingName,
            property_type: modalCurrentBuilding.propertyType,
            sigungu_code: modalCurrentBuilding.sigunguCode,
            umd_name: modalCurrentBuilding.umdName,
            jibun: modalCurrentBuilding.jibun,
            page: modalCurrentPage,
            page_size: 50
        })
    })
    .then(response => response.json())
    .then(data => {
        modalLoading.style.display = 'none';

        if (data.success) {
            displayBuildingTransactions(data.data, modalCurrentBuilding.propertyType, append);
            modalHasMoreData = data.has_more || false;

            console.log('[모달무한스크롤] 응답 받음:', {
                count: data.count,
                has_more: data.has_more,
                append: append
            });
        } else {
            if (!append) {
                modalError.textContent = data.error || '데이터를 불러오는 중 오류가 발생했습니다.';
                modalError.style.display = 'block';
            }
        }
    })
    .catch(error => {
        modalLoading.style.display = 'none';
        if (!append) {
            modalError.textContent = '서버 오류가 발생했습니다.';
            modalError.style.display = 'block';
        }
        console.error('Error:', error);
    })
    .finally(() => {
        modalIsLoading = false;
        console.log('[모달무한스크롤] isLoading = false');
    });
}

// 모달 데이터 표시
function displayBuildingTransactions(data, propertyType, append = false) {
    const modalTableBody = document.querySelector('#modal-results-table tbody');

    if (!data || data.length === 0) {
        if (!append) {
            modalTableBody.innerHTML = '<tr><td colspan="14" class="no-data">데이터가 없습니다.</td></tr>';
        }
        return;
    }

    // 데이터 저장 (필터링 전 원본 데이터)
    if (append) {
        modalAllData = modalAllData.concat(data);
    } else {
        modalAllData = data;
    }

    // 필터 적용 여부 확인
    const futureOnlyCheckbox = document.getElementById('future-listings-only');
    const showFutureOnly = futureOnlyCheckbox ? futureOnlyCheckbox.checked : false;

    // 필터링 및 정렬
    const filteredData = filterAndSortModalData(modalAllData, showFutureOnly);

    // append 모드에서는 전체를 다시 렌더링 (필터링 때문에)
    // 새 검색 - HTML로 한 번에 설정
    const rowsHTML = filteredData.map(row => {
        // 보증금 포맷 선택: 오피스텔은 기준시가, 아파트/연립다세대는 공동주택가격
        let depositHTML;
        if (propertyType === '오피스텔') {
            depositHTML = formatDepositWithStandardPrice(row);
        } else if (propertyType === '아파트' || propertyType === '연립다세대') {
            depositHTML = formatDepositWithApartmentPrice(row);
        } else {
            depositHTML = formatPrice(row.보증금);
        }

        return `
            <tr>
                <td>${row.계약년월 || ''}</td>
                <td>${row.계약일 || ''}</td>
                <td class="unit-info-cell">${formatUnitInfo(row)}</td>
                <td>${row.층 || ''}</td>
                <td>${row.면적 || ''}</td>
                <td>${getContractTypeBadge(row.월세)}</td>
                <td>${depositHTML}</td>
                <td>${formatPrice(row.월세)}</td>
                <td>${row.건축년도 || ''}</td>
                <td>${row.계약구분 || ''}</td>
                <td>${getContractPeriodWithBadge(row.계약기간)}</td>
                <td>${formatPrice(row.종전계약보증금)}</td>
                <td>${formatPrice(row.종전계약월세)}</td>
                <td>${row.갱신요구권사용 || ''}</td>
            </tr>
        `;
    }).join('');

    modalTableBody.innerHTML = rowsHTML;
}

// 모달 닫기
document.querySelector('.modal-close').addEventListener('click', function() {
    document.getElementById('building-modal').style.display = 'none';
});

// 모달 배경 클릭 시 닫기
document.getElementById('building-modal').addEventListener('click', function(e) {
    if (e.target === this) {
        this.style.display = 'none';
    }
});

// 모달 테이블 재렌더링 (필터 적용)
function reRenderModalTable() {
    if (modalAllData.length === 0 || !modalCurrentBuilding) {
        return;
    }

    const propertyType = modalCurrentBuilding.propertyType;
    const modalTableBody = document.querySelector('#modal-results-table tbody');

    // 필터 적용 여부 확인
    const futureOnlyCheckbox = document.getElementById('future-listings-only');
    const showFutureOnly = futureOnlyCheckbox ? futureOnlyCheckbox.checked : false;

    // 필터링 및 정렬
    const filteredData = filterAndSortModalData(modalAllData, showFutureOnly);

    if (filteredData.length === 0) {
        modalTableBody.innerHTML = '<tr><td colspan="14" class="no-data">조건에 맞는 데이터가 없습니다.</td></tr>';
        return;
    }

    // HTML로 한 번에 설정
    const rowsHTML = filteredData.map(row => {
        // 보증금 포맷 선택: 오피스텔은 기준시가, 아파트/연립다세대는 공동주택가격
        let depositHTML;
        if (propertyType === '오피스텔') {
            depositHTML = formatDepositWithStandardPrice(row);
        } else if (propertyType === '아파트' || propertyType === '연립다세대') {
            depositHTML = formatDepositWithApartmentPrice(row);
        } else {
            depositHTML = formatPrice(row.보증금);
        }

        return `
            <tr>
                <td>${row.계약년월 || ''}</td>
                <td>${row.계약일 || ''}</td>
                <td class="unit-info-cell">${formatUnitInfo(row)}</td>
                <td>${row.층 || ''}</td>
                <td>${row.면적 || ''}</td>
                <td>${getContractTypeBadge(row.월세)}</td>
                <td>${depositHTML}</td>
                <td>${formatPrice(row.월세)}</td>
                <td>${row.건축년도 || ''}</td>
                <td>${row.계약구분 || ''}</td>
                <td>${getContractPeriodWithBadge(row.계약기간)}</td>
                <td>${formatPrice(row.종전계약보증금)}</td>
                <td>${formatPrice(row.종전계약월세)}</td>
                <td>${row.갱신요구권사용 || ''}</td>
            </tr>
        `;
    }).join('');

    modalTableBody.innerHTML = rowsHTML;
}

// 미래 매물 필터 체크박스 이벤트
document.addEventListener('DOMContentLoaded', function() {
    const futureOnlyCheckbox = document.getElementById('future-listings-only');
    if (futureOnlyCheckbox) {
        futureOnlyCheckbox.addEventListener('change', function() {
            // 체크박스 변경 시 필터 적용하여 재렌더링
            reRenderModalTable();
        });
    }
});

// 모달 무한 스크롤 설정
let modalScrollHandler = null;

function setupModalInfiniteScroll() {
    const modalTableContainer = document.querySelector('.modal-table-container');
    if (!modalTableContainer) {
        console.error('[모달무한스크롤] modal-table-container를 찾을 수 없음');
        return;
    }

    // 기존 이벤트 리스너 제거
    if (modalScrollHandler) {
        modalTableContainer.removeEventListener('scroll', modalScrollHandler);
        console.log('[모달무한스크롤] 기존 리스너 제거');
    }

    modalScrollHandler = debounce(() => {
        const scrollTop = modalTableContainer.scrollTop;
        const clientHeight = modalTableContainer.clientHeight;
        const scrollHeight = modalTableContainer.scrollHeight;
        const isNearBottom = scrollTop + clientHeight >= scrollHeight - 100;

        console.log('[모달무한스크롤] 스크롤 이벤트:', {
            scrollTop,
            clientHeight,
            scrollHeight,
            isNearBottom,
            isLoading: modalIsLoading,
            hasMoreData: modalHasMoreData
        });

        if (isNearBottom && !modalIsLoading && modalHasMoreData && modalCurrentBuilding) {
            console.log('[모달무한스크롤] 추가 데이터 로드 시작');
            loadMoreModalData();
        }
    }, 150);

    modalTableContainer.addEventListener('scroll', modalScrollHandler);
    console.log('[모달무한스크롤] 새 리스너 등록 완료');
}

// 모달 더 많은 데이터 로드
function loadMoreModalData() {
    if (modalIsLoading || !modalHasMoreData) {
        console.log('[모달무한스크롤] loadMoreModalData 중단:', {
            isLoading: modalIsLoading,
            hasMoreData: modalHasMoreData
        });
        return;
    }

    console.log('[모달무한스크롤] 페이지 증가:', modalCurrentPage, '->', modalCurrentPage + 1);
    modalCurrentPage++;

    loadBuildingTransactions(true); // append 모드
}

// 툴팁 DOM 요소 생성 및 관리
let tooltipElement = null;
let currentTooltipTarget = null;

function createTooltip() {
    if (!tooltipElement) {
        tooltipElement = document.createElement('div');
        tooltipElement.className = 'custom-tooltip';
        tooltipElement.style.cssText = `
            position: fixed;
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 12px 16px;
            border-radius: 6px;
            font-size: 12px;
            line-height: 1.6;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 10000;
            pointer-events: none;
            display: none;
            min-width: 280px;
            text-align: left;
        `;
        document.body.appendChild(tooltipElement);
    }
    return tooltipElement;
}

function showTooltip(target) {
    const tooltip = createTooltip();
    const htmlContent = target.getAttribute('data-tooltip-html');
    if (!htmlContent) return;

    tooltip.innerHTML = htmlContent;
    tooltip.style.display = 'block';

    // 위치 계산
    const rect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    // 툴팁을 대상 위에 표시
    let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
    let top = rect.top - tooltipRect.height - 8;

    // 화면 밖으로 나가지 않도록 조정
    if (left < 10) left = 10;
    if (left + tooltipRect.width > window.innerWidth - 10) {
        left = window.innerWidth - tooltipRect.width - 10;
    }
    if (top < 10) {
        // 위에 공간이 없으면 아래에 표시
        top = rect.bottom + 8;
    }

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';

    currentTooltipTarget = target;
}

function hideTooltip() {
    if (tooltipElement) {
        tooltipElement.style.display = 'none';
    }
    currentTooltipTarget = null;
}

// 보증금 툴팁 이벤트 (hover + click) - 오피스텔 기준시가 & 아파트/연립다세대 공동주택가격
document.addEventListener('mouseover', function(e) {
    if (e.target && (e.target.classList.contains('deposit-with-standard-price') ||
                     e.target.classList.contains('deposit-with-apartment-price'))) {
        showTooltip(e.target);
    }
});

document.addEventListener('mouseout', function(e) {
    if (e.target && (e.target.classList.contains('deposit-with-standard-price') ||
                     e.target.classList.contains('deposit-with-apartment-price'))) {
        // 클릭으로 고정된 상태가 아니면 숨김
        if (!e.target.classList.contains('tooltip-active')) {
            hideTooltip();
        }
    }
});

document.addEventListener('click', function(e) {
    if (e.target && (e.target.classList.contains('deposit-with-standard-price') ||
                     e.target.classList.contains('deposit-with-apartment-price'))) {
        e.stopPropagation();

        // 다른 모든 활성화된 툴팁 닫기
        document.querySelectorAll('.deposit-with-standard-price.tooltip-active, .deposit-with-apartment-price.tooltip-active').forEach(el => {
            if (el !== e.target) {
                el.classList.remove('tooltip-active');
            }
        });

        // 현재 툴팁 토글
        if (e.target.classList.contains('tooltip-active')) {
            e.target.classList.remove('tooltip-active');
            hideTooltip();
        } else {
            e.target.classList.add('tooltip-active');
            showTooltip(e.target);
        }
    } else {
        // 다른 곳 클릭 시 모든 툴팁 닫기
        document.querySelectorAll('.deposit-with-standard-price.tooltip-active, .deposit-with-apartment-price.tooltip-active').forEach(el => {
            el.classList.remove('tooltip-active');
        });
        hideTooltip();
    }
});


// ============ 건물 검색 (버튼 방식) 기능 ============

function initBuildingSearch() {
    const searchInput = document.getElementById('building-search-input');
    const searchBtn = document.getElementById('building-search-btn');
    const resultsContainer = document.getElementById('building-search-results');

    if (!searchInput || !searchBtn || !resultsContainer) return;

    // 검색 버튼 클릭 이벤트
    searchBtn.addEventListener('click', function() {
        const query = searchInput.value.trim();

        if (query.length < 2) {
            alert('읍면동명과 지번을 2글자 이상 입력해주세요.');
            return;
        }

        searchBuildings(query);
    });

    // Enter 키로도 검색 가능
    searchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            searchBtn.click();
        }
    });
}

function searchBuildings(query) {
    const resultsContainer = document.getElementById('building-search-results');

    // 로딩 스피너 표시
    resultsContainer.innerHTML = `
        <div style="text-align: center; padding: 40px;">
            <div class="spinner" style="
                border: 4px solid rgba(255, 255, 255, 0.3);
                border-top: 4px solid white;
                border-radius: 50%;
                width: 40px;
                height: 40px;
                animation: spin 1s linear infinite;
                margin: 0 auto;
            "></div>
            <style>
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
        </div>
    `;
    resultsContainer.style.display = 'block';

    // API 호출
    fetch(`/api/search-building?q=${encodeURIComponent(query)}`)
        .then(response => response.json())
        .then(data => {
            if (data.success && data.buildings && data.buildings.length > 0) {
                displayBuildingResults(data.buildings);
            } else {
                resultsContainer.innerHTML = `
                    <div style="
                        text-align: center;
                        padding: 40px 20px;
                        background: #f8fafc;
                        border-radius: 8px;
                        border: 1px solid #e2e8f0;
                        color: #64748b;
                        font-size: 15px;
                    ">
                        <div style="font-size: 48px; margin-bottom: 16px;">🔍</div>
                        <div style="font-weight: 500; margin-bottom: 8px;">검색 결과가 없습니다.</div>
                        <div style="font-size: 13px; color: #94a3b8;">다른 검색어로 다시 시도해주세요.</div>
                    </div>
                `;
            }
        })
        .catch(error => {
            console.error('건물 검색 오류:', error);
            resultsContainer.innerHTML = `
                <div style="
                    text-align: center;
                    padding: 40px 20px;
                    background: #fef2f2;
                    border-radius: 8px;
                    border: 1px solid #fecaca;
                    color: #dc2626;
                    font-size: 15px;
                ">
                    <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
                    <div style="font-weight: 500;">검색 중 오류가 발생했습니다.</div>
                </div>
            `;
        });
}

function displayBuildingResults(buildings) {
    const resultsContainer = document.getElementById('building-search-results');

    if (buildings.length === 0) {
        resultsContainer.innerHTML = `
            <div style="
                text-align: center;
                padding: 40px 20px;
                background: #f8fafc;
                border-radius: 8px;
                border: 1px solid #e2e8f0;
                color: #64748b;
                font-size: 15px;
            ">
                <div style="font-size: 48px; margin-bottom: 16px;">🔍</div>
                <div style="font-weight: 500; margin-bottom: 8px;">검색 결과가 없습니다.</div>
                <div style="font-size: 13px; color: #94a3b8;">다른 검색어로 다시 시도해주세요.</div>
            </div>
        `;
        return;
    }

    resultsContainer.innerHTML = '';
    resultsContainer.style.display = 'grid';
    resultsContainer.style.gridTemplateColumns = 'repeat(auto-fill, minmax(300px, 1fr))';
    resultsContainer.style.gap = '16px';

    buildings.forEach(building => {
        const card = document.createElement('div');
        card.style.cssText = 'border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; cursor: pointer; transition: all 0.2s; background: white;';

        // 주택 유형별 색상
        const typeColors = {
            '아파트': '#3b82f6',
            '연립다세대': '#10b981',
            '오피스텔': '#f59e0b',
            '단독다가구': '#8b5cf6'
        };
        const typeColor = typeColors[building.property_type] || '#6b7280';

        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-weight: 600; font-size: 16px; color: #1e293b;">${building.building_name || '(건물명 없음)'}</span>
                <span style="background: ${typeColor}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600;">${building.property_type}</span>
            </div>
            <div style="color: #64748b; font-size: 14px;">${building.full_address}</div>
        `;

        // 호버 효과
        card.addEventListener('mouseenter', () => {
            card.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
            card.style.transform = 'translateY(-2px)';
        });
        card.addEventListener('mouseleave', () => {
            card.style.boxShadow = 'none';
            card.style.transform = 'none';
        });

        // 클릭 이벤트
        card.addEventListener('click', () => {
            openBuildingModal(
                building.building_name,
                building.property_type,
                building.sgg_code,
                building.umd_name,
                building.jibun,
                building.sido,
                building.sigungu
            );
        });

        resultsContainer.appendChild(card);
    });
}

function openBuildingDetailModal(building) {
    const modal = document.getElementById('building-modal');
    const modalBuildingName = document.getElementById('modal-building-name');
    const modalLoading = document.getElementById('modal-loading');
    const modalError = document.getElementById('modal-error');
    const modalTableBody = document.querySelector('#modal-results-table tbody');

    // 모달 제목 설정
    modalBuildingName.textContent = building.building_name || building.full_address;

    // 관페 바로가기 링크 설정
    const gwanpeLink = document.getElementById('gwanpe-link');
    if (gwanpeLink && building.umd_name && building.jibun) {
        const searchQuery = `${building.umd_name} ${building.jibun}`;
        const encodedQuery = encodeURIComponent(searchQuery);
        gwanpeLink.href = `https://ziptoss.com/v2/admin/buildings?search=${encodedQuery}`;
    }

    // 모달 표시
    modal.style.display = 'block';
    modalLoading.style.display = 'block';
    modalError.style.display = 'none';
    modalTableBody.innerHTML = '<tr><td colspan="14" class="no-data">조회 중...</td></tr>';

    // API 호출하여 거래 내역 조회
    const params = new URLSearchParams({
        property_type: building.property_type,
        sgg_code: building.sgg_code,
        umd_name: building.umd_name,
        jibun: building.jibun,
        building_name: building.building_name || ''
    });

    fetch(`/api/building-transactions?${params.toString()}`)
        .then(response => response.json())
        .then(data => {
            modalLoading.style.display = 'none';

            if (data.success && data.transactions.length > 0) {
                displayModalTransactions(data.transactions);
            } else {
                modalTableBody.innerHTML = '<tr><td colspan="14" class="no-data">거래 내역이 없습니다</td></tr>';
            }
        })
        .catch(error => {
            console.error('건물 거래 내역 조회 오류:', error);
            modalLoading.style.display = 'none';
            modalError.textContent = '거래 내역을 불러오는 중 오류가 발생했습니다.';
            modalError.style.display = 'block';
        });
}

function displayModalTransactions(transactions) {
    const modalTableBody = document.querySelector('#modal-results-table tbody');
    modalTableBody.innerHTML = '';

    transactions.forEach(row => {
        const tr = document.createElement('tr');

        // 공동주택가격 기반 폰트 색상 결정
        let depositColor = 'inherit';
        if (row['공동주택가격'] && row['공동주택가격_126퍼센트']) {
            const deposit = parseFloat(row['보증금'].replace(/,/g, '')) * 10000;
            const threshold = row['공동주택가격_126퍼센트'];
            depositColor = deposit < threshold ? '#4169e1' : 'inherit';
        }

        // 툴팁 메시지
        let tooltipText = '';
        if (row['공동주택가격']) {
            const price = (row['공동주택가격'] / 10000).toFixed(0);
            const threshold = (row['공동주택가격_126퍼센트'] / 10000).toFixed(0);
            tooltipText = `공동주택가격: ${price}만원\n126%: ${threshold}만원`;
        }

        tr.innerHTML = `
            <td>${row['계약년월'] || '-'}</td>
            <td>${row['계약일'] || '-'}</td>
            <td title="${row['동·호명'] || ''}">${row['동·호명'] || '-'}</td>
            <td>${row['층'] || '-'}</td>
            <td>${row['면적'] || '-'}</td>
            <td>${row['전월세구분'] || '-'}</td>
            <td style="color: ${depositColor};" title="${tooltipText}">${row['보증금'] || '-'}</td>
            <td>${row['월세'] || '-'}</td>
            <td>${row['건축년도'] || '-'}</td>
            <td>${row['계약구분'] || '-'}</td>
            <td>${row['계약기간'] || '-'}</td>
            <td>${row['종전계약보증금'] || '-'}</td>
            <td>${row['종전계약월세'] || '-'}</td>
            <td>${row['갱신요구권사용'] || '-'}</td>
        `;

        modalTableBody.appendChild(tr);
    });
}

// ============================================================================
// 탭 전환 기능
// ============================================================================

// 모달 열릴 때 저장할 건물 정보
let currentBuildingInfo = null;

// 탭 전환 이벤트 리스너
document.addEventListener('DOMContentLoaded', function() {
    const tabButtons = document.querySelectorAll('.tab-btn');

    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const tabName = this.getAttribute('data-tab');

            // 모든 탭 버튼과 콘텐츠에서 active 클래스 제거
            tabButtons.forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
                content.style.display = 'none';
            });

            // 클릭한 탭 버튼과 콘텐츠에 active 클래스 추가
            this.classList.add('active');
            const targetContent = document.getElementById(`tab-${tabName}`);
            if (targetContent) {
                targetContent.classList.add('active');
                targetContent.style.display = 'block';
            }

            // 소유자 정보 탭으로 전환 시 데이터 로드
            if (tabName === 'owner-info' && currentBuildingInfo) {
                loadOwnerInfo(currentBuildingInfo);
            }
        });
    });
});

// ============================================================================
// 소유자 정보 API 호출
// ============================================================================

function loadOwnerInfo(buildingInfo) {
    const ownerLoading = document.getElementById('owner-loading');
    const ownerError = document.getElementById('owner-error');
    const ownerContent = document.getElementById('owner-info-content');

    // 로딩 시작
    ownerLoading.style.display = 'block';
    ownerError.style.display = 'none';
    ownerContent.innerHTML = '';

    console.log('소유자 정보 조회:', {
        sgg_code: buildingInfo.sigunguCode,
        umd_name: buildingInfo.umdName,
        jibun: buildingInfo.jibun
    });

    // API 호출
    fetch('/api/owner-info', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            sgg_code: buildingInfo.sigunguCode,
            umd_name: buildingInfo.umdName,
            jibun: buildingInfo.jibun
        })
    })
    .then(response => response.json())
    .then(result => {
        ownerLoading.style.display = 'none';

        if (result.error) {
            ownerError.textContent = `오류: ${result.error}`;
            ownerError.style.display = 'block';
            return;
        }

        if (result.message) {
            ownerContent.innerHTML = `<p style="padding: 20px; text-align: center; color: #64748b;">${result.message}</p>`;
            return;
        }

        displayOwnerInfo(result.data);
    })
    .catch(error => {
        console.error('소유자 정보 조회 오류:', error);
        ownerLoading.style.display = 'none';
        ownerError.textContent = '소유자 정보를 불러오는 중 오류가 발생했습니다.';
        ownerError.style.display = 'block';
    });
}

function displayOwnerInfo(groupedData) {
    const ownerContent = document.getElementById('owner-info-content');

    if (!groupedData || Object.keys(groupedData).length === 0) {
        ownerContent.innerHTML = '<p style="padding: 20px; text-align: center; color: #64748b;">소유자 정보가 없습니다.</p>';
        return;
    }

    // 분양 상태 분석
    const distributionMessage = analyzeOwnershipDistribution(groupedData);

    let html = '';

    // 분양 상태 메시지 표시
    if (distributionMessage) {
        html += `
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 16px 20px; border-radius: 10px; margin-bottom: 20px; font-size: 14px; line-height: 1.6;">
                ${distributionMessage}
            </div>
        `;
    }

    // 동·호별로 그룹화된 데이터 렌더링
    for (const [unitKey, owners] of Object.entries(groupedData)) {
        // 소유자 수 계산 (공유인수 + 1 또는 배열 길이)
        const ownerCount = owners.length > 0 ? (parseInt(owners[0].cnrsPsnCo) + 1) : 1;

        // 소유 기간 계산
        let ownershipPeriodText = '';
        if (owners.length > 0) {
            const firstOwner = owners[0];
            const causeCode = firstOwner.ownshipChgCauseCodeNm;

            console.log(`[소유기간] ${unitKey} - 변동원인: ${causeCode}, 변동일자: ${firstOwner.ownshipChgDe}`);

            if (causeCode === '소유권이전' || causeCode === '소유권보존') {
                const changeDate = firstOwner.ownshipChgDe;
                if (changeDate && (changeDate.length === 8 || changeDate.length === 10)) {
                    const period = calculateOwnershipPeriod(changeDate);
                    console.log(`[소유기간] ${unitKey} - 계산된 기간: ${period}`);
                    if (period) {
                        ownershipPeriodText = ` <span style="color: rgba(255, 255, 255, 0.85); font-weight: normal;">| 소유기간 ${period}</span>`;
                    }
                } else {
                    console.log(`[소유기간] ${unitKey} - 변동일자 형식 오류 (길이: ${changeDate ? changeDate.length : 'null'})`);
                }
            } else {
                console.log(`[소유기간] ${unitKey} - 조건 불일치 (소유권이전/보존 아님)`);
            }
        }

        html += `
            <div class="owner-unit-group">
                <div class="owner-unit-header">
                    <span class="owner-unit-title">${unitKey}</span>
                    <span class="owner-count">소유자: ${ownerCount}명${ownershipPeriodText}</span>
                </div>
                <div class="owner-table-wrapper">
                    <table class="owner-info-table" style="width: 100%; table-layout: fixed;">
                        <thead>
                            <tr>
                                <th style="width: 25%;">소유자 구분</th>
                                <th style="width: 25%;">소유자 거주지</th>
                                <th style="width: 25%;">소유권변동일자</th>
                                <th style="width: 25%;">소유권변동원인</th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        owners.forEach(owner => {
            html += `
                <tr>
                    <td style="width: 25%;">${owner.posesnSeCodeNm}</td>
                    <td style="width: 25%;">${owner.resdncSeCodeNm}</td>
                    <td style="width: 25%;">${owner.ownshipChgDe}</td>
                    <td style="width: 25%;">${owner.ownshipChgCauseCodeNm}</td>
                </tr>
            `;
        });

        html += `
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    ownerContent.innerHTML = html;
}

// 소유 기간 계산 함수
function calculateOwnershipPeriod(changeDateStr) {
    try {
        let year, month, day;

        // YYYY-MM-DD 형식 (10자리) 또는 YYYYMMDD 형식 (8자리) 처리
        if (changeDateStr.includes('-')) {
            // YYYY-MM-DD 형식
            const parts = changeDateStr.split('-');
            year = parseInt(parts[0]);
            month = parseInt(parts[1]) - 1; // 0-indexed
            day = parseInt(parts[2]);
        } else if (changeDateStr.length === 8) {
            // YYYYMMDD 형식
            year = parseInt(changeDateStr.substring(0, 4));
            month = parseInt(changeDateStr.substring(4, 6)) - 1; // 0-indexed
            day = parseInt(changeDateStr.substring(6, 8));
        } else {
            console.error('소유 기간 계산 오류: 지원하지 않는 날짜 형식', changeDateStr);
            return null;
        }

        const changeDate = new Date(year, month, day);
        const today = new Date();

        // 년/월 차이 계산
        let years = today.getFullYear() - changeDate.getFullYear();
        let months = today.getMonth() - changeDate.getMonth();
        let days = today.getDate() - changeDate.getDate();

        // 일수가 음수면 이전 달에서 빌림
        if (days < 0) {
            months--;
        }

        // 월수가 음수면 이전 연도에서 빌림
        if (months < 0) {
            years--;
            months += 12;
        }

        // 결과 포맷팅
        if (years > 0 && months > 0) {
            return `${years}년 ${months}개월`;
        } else if (years > 0) {
            return `${years}년`;
        } else if (months > 0) {
            return `${months}개월`;
        } else {
            return '1개월 미만';
        }
    } catch (error) {
        console.error('소유 기간 계산 오류:', error);
        return null;
    }
}

// 소유권 분포 분석 함수
function analyzeOwnershipDistribution(groupedData) {
    const units = Object.keys(groupedData);

    // 호실이 1개 이하면 분석하지 않음
    if (units.length <= 1) {
        return null;
    }

    // 각 호실의 소유자 정보를 signature로 변환
    const unitSignatures = {};
    for (const [unitKey, owners] of Object.entries(groupedData)) {
        // 소유자 정보를 정렬하여 signature 생성
        const signature = owners.map(owner =>
            `${owner.posesnSeCodeNm}|${owner.resdncSeCodeNm}|${owner.ownshipChgDe}|${owner.ownshipChgCauseCodeNm}|${owner.cnrsPsnCo}`
        ).sort().join('::');

        unitSignatures[unitKey] = {
            signature: signature,
            ownerCount: owners.length > 0 ? (parseInt(owners[0].cnrsPsnCo) + 1) : 1
        };

        // 디버깅: 각 호실의 signature 출력
        console.log(`[소유권분석] ${unitKey}:`, signature);
    }

    // signature별로 호실 그룹화
    const signatureGroups = {};
    for (const [unitKey, data] of Object.entries(unitSignatures)) {
        if (!signatureGroups[data.signature]) {
            signatureGroups[data.signature] = {
                units: [],
                ownerCount: data.ownerCount
            };
        }
        signatureGroups[data.signature].units.push(unitKey);
    }

    const groupCount = Object.keys(signatureGroups).length;
    const totalUnits = units.length;

    // 디버깅: 그룹화 결과 출력
    console.log(`[소유권분석] 전체 호실 수: ${totalUnits}, 그룹 수: ${groupCount}`);
    console.log('[소유권분석] 그룹별 호실:', signatureGroups);

    // 경우 1: 모든 호실이 동일한 소유자 (미분양)
    if (groupCount === 1) {
        const ownerCount = Object.values(signatureGroups)[0].ownerCount;
        return `이 건물은 분양되지 않았으며, 모든 호실을 ${ownerCount}명이 소유하고 있는 것으로 추정됩니다.`;
    }

    // 경우 2: 모든 호실이 다른 소유자 (완전 분양)
    if (groupCount === totalUnits) {
        return `이 건물은 모든 호실이 분양된 것으로 추정됩니다.`;
    }

    // 경우 3: 일부 호실만 동일한 소유자 (부분 분양)
    // 2개 이상의 호실을 가진 그룹만 추출
    const sameOwnerGroups = [];
    for (const [signature, data] of Object.entries(signatureGroups)) {
        console.log(`[소유권분석] signature 그룹: ${data.units.join(', ')} (${data.units.length}개 호실)`);

        // 중요: 2개 이상의 호실이 동일한 소유자를 가질 때만 추가
        if (data.units.length >= 2) {
            sameOwnerGroups.push({
                units: data.units,
                ownerCount: data.ownerCount
            });
            console.log(`  → 동일 소유자 그룹으로 추가됨`);
        } else {
            console.log(`  → 단일 호실이므로 제외됨`);
        }
    }

    console.log(`[소유권분석] 동일 소유자 그룹 수: ${sameOwnerGroups.length}`);

    // 2개 이상 묶인 그룹이 없으면 완전 분양
    if (sameOwnerGroups.length === 0) {
        console.log(`[소유권분석] 결과: 모든 호실 분양됨`);
        return `이 건물은 모든 호실이 분양된 것으로 추정됩니다.`;
    }

    // 메시지 생성
    const groupMessages = sameOwnerGroups.map(group =>
        `${group.units.join(', ')}은 동일 소유자 ${group.ownerCount}명이`
    ).join(', ');

    // 모든 호실이 동일 소유자 그룹에 속하는지 확인
    const totalSameOwnerUnits = sameOwnerGroups.reduce((sum, group) => sum + group.units.length, 0);

    console.log(`[소유권분석] 동일 소유자가 소유한 호실 수: ${totalSameOwnerUnits} / ${totalUnits}`);

    if (totalSameOwnerUnits === totalUnits) {
        console.log(`[소유권분석] 결과: 모든 호실이 동일 소유자 그룹들에 속함`);
        return `${groupMessages} 소유한 것으로 추정됩니다.`;
    } else {
        console.log(`[소유권분석] 결과: 일부만 동일 소유자, 나머지는 분양됨`);
        return `${groupMessages} 소유하고 있으며, 나머지 호실들은 분양된 것으로 추정됩니다.`;
    }
}