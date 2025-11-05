// 무한 스크롤 + 성능 최적화 버전
let currentPage = 1;
let isLoading = false;
let hasMoreData = true;
let currentFilters = null;
let totalCount = 0;

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
    if (!value || value === '0' || value === 0) return '';

    // 쉼표 제거하고 숫자로 변환
    const num = parseInt(String(value).replace(/,/g, ''));
    if (isNaN(num)) return '';

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

            tr.innerHTML = `
                <td><span class="badge ${badgeClass}">${row.구분}</span></td>
                <td>${row.시도 || ''}</td>
                <td>${row.시군구 || ''}</td>
                <td>${row.읍면동리 || ''}</td>
                <td>${row.지번 || ''}</td>
                <td>${row.단지명 || row.건물명 || ''}</td>
                <td>${row.층 || ''}</td>
                <td>${row.면적 || ''}</td>
                <td>${getContractTypeBadge(row.월세)}</td>
                <td>${formatPrice(row.보증금)}</td>
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
                rowsHTML += `
                    <tr>
                        <td><span class="badge ${badgeClass}">${row.구분}</span></td>
                        <td>${row.시도 || ''}</td>
                        <td>${row.시군구 || ''}</td>
                        <td>${row.읍면동리 || ''}</td>
                        <td>${row.지번 || ''}</td>
                        <td>${row.단지명 || row.건물명 || ''}</td>
                        <td>${row.층 || ''}</td>
                        <td>${row.면적 || ''}</td>
                        <td>${getContractTypeBadge(row.월세)}</td>
                        <td>${formatPrice(row.보증금)}</td>
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
