// 무한 스크롤 + 성능 최적화 버전
let currentPage = 1;
let isLoading = false;
let hasMoreData = true;
let currentFilters = null;
let totalCount = 0;

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', function() {
    loadSidos();
    setupInfiniteScroll();
});

// 무한 스크롤 설정
function setupInfiniteScroll() {
    const tableContainer = document.querySelector('.table-container');
    if (tableContainer) {
        tableContainer.addEventListener('scroll', () => {
            if (tableContainer.scrollTop + tableContainer.clientHeight >= tableContainer.scrollHeight - 100) {
                if (!isLoading && hasMoreData && currentFilters) {
                    loadMoreData();
                }
            }
        });
    }
}

// 더 많은 데이터 로드
function loadMoreData() {
    if (isLoading || !hasMoreData) return;

    currentPage++;
    searchTransactions(true); // append 모드
}

// 시도 목록 로드
function loadSidos() {
    fetch('/api/locations/sido')
        .then(response => response.json())
        .then(data => {
            const sidoSelect = document.getElementById('sido');
            sidoSelect.innerHTML = '<option value="">전체</option>';

            data.sidos.forEach(sido => {
                const option = document.createElement('option');
                option.value = sido;
                option.textContent = sido;
                sidoSelect.appendChild(option);
            });

            sidoSelect.addEventListener('change', loadSigungus);
        })
        .catch(error => {
            console.error('Error loading sidos:', error);
        });
}

// 시군구 목록 로드
function loadSigungus() {
    const sido = document.getElementById('sido').value;
    const container = document.getElementById('sigungu-checkboxes');

    if (!sido) {
        container.innerHTML = '<div class="placeholder-text">시도를 먼저 선택해주세요</div>';
        clearUmds();
        return;
    }

    fetch(`/api/locations/sigungu?sido=${encodeURIComponent(sido)}`)
        .then(response => response.json())
        .then(data => {
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

            data.sigungus.forEach(sigungu => {
                const label = document.createElement('label');
                label.className = 'checkbox-label';
                label.innerHTML = `
                    <input type="checkbox" name="sigungu" value="${sigungu}" checked>
                    ${sigungu}
                `;
                container.appendChild(label);
            });

            // 시군구 변경 이벤트 리스너 추가
            container.addEventListener('change', loadUmds);
            loadUmds(); // 초기 로드
        })
        .catch(error => {
            console.error('Error loading sigungus:', error);
            container.innerHTML = '<div class="placeholder-text">시군구 로드 중 오류가 발생했습니다</div>';
        });
}

// 읍면동 목록 로드
function loadUmds() {
    const sido = document.getElementById('sido').value;
    const selectedSigungus = Array.from(document.querySelectorAll('input[name="sigungu"]:checked')).map(cb => cb.value);
    const container = document.getElementById('umd-checkboxes');

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

                    container.appendChild(groupDiv);
                }
            });
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
    const container = document.getElementById('umd-checkboxes');
    container.innerHTML = '<div class="placeholder-text">시군구를 먼저 선택해주세요</div>';
}

// 검색 함수
function searchTransactions(append = false) {
    if (isLoading) return;

    // 새로운 검색인 경우 초기화
    if (!append) {
        currentPage = 1;
        hasMoreData = true;
        totalCount = 0;
    }

    isLoading = true;

    // 필터 수집
    const filters = {
        include_apt: document.getElementById('include-apt').checked,
        include_villa: document.getElementById('include-villa').checked,
        include_dagagu: document.getElementById('include-dagagu').checked,
        include_officetel: document.getElementById('include-officetel').checked,
        include_finished: document.getElementById('include-finished').checked,
        include_ongoing: document.getElementById('include-ongoing').checked,
        sido: document.getElementById('sido').value,
        sigungu: Array.from(document.querySelectorAll('input[name="sigungu"]:checked')).map(cb => cb.value),
        umd: Array.from(document.querySelectorAll('input[name="umd"]:checked')).map(cb => cb.value),
        area_min: document.getElementById('area-min').value,
        area_max: document.getElementById('area-max').value,
        deposit_min: document.getElementById('deposit-min').value,
        deposit_max: document.getElementById('deposit-max').value,
        rent_min: document.getElementById('rent-min').value,
        rent_max: document.getElementById('rent-max').value,
        build_year_min: document.getElementById('build-year-min').value,
        build_year_max: document.getElementById('build-year-max').value,
        page: currentPage,
        page_size: 20
    };

    currentFilters = filters;

    // 로딩 표시
    if (!append) {
        document.getElementById('result-container').innerHTML = `
            <div class="loading">
                <div class="spinner"></div>
                <p>검색 중...</p>
            </div>
        `;
    } else {
        // 기존 테이블 하단에 로딩 표시 추가
        const existingTable = document.querySelector('.table-container');
        if (existingTable) {
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'loading-more';
            loadingDiv.id = 'loading-more';
            loadingDiv.textContent = '더 많은 데이터를 불러오는 중...';
            existingTable.after(loadingDiv);
        }
    }

    fetch('/api/search', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(filters)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            displayResults(data, append);

            // 페이지네이션 정보 업데이트
            hasMoreData = data.has_more || false;

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
        if (!append) {
            document.getElementById('result-container').innerHTML = `
                <div class="error-message">
                    오류: ${error.message}
                </div>
            `;
        }
    })
    .finally(() => {
        isLoading = false;
        // 로딩 표시 제거
        const loadingMore = document.getElementById('loading-more');
        if (loadingMore) {
            loadingMore.remove();
        }
    });
}

// 결과 표시
function displayResults(data, append = false) {
    const container = document.getElementById('result-container');

    if (!data.data || data.data.length === 0) {
        if (!append) {
            container.innerHTML = '<div class="no-data">검색 조건에 맞는 데이터가 없습니다.</div>';
        }
        hasMoreData = false;
        return;
    }

    let tableHTML = '';

    if (!append) {
        // 새로운 검색 - 테이블 전체 생성
        tableHTML = `
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>구분</th>
                            <th>시도</th>
                            <th>시군구</th>
                            <th>읍면동리</th>
                            <th>지번</th>
                            <th>건물명</th>
                            <th>층</th>
                            <th>면적(㎡)</th>
                            <th>보증금<br>(만원)</th>
                            <th>월세<br>(만원)</th>
                            <th>계약년월</th>
                            <th>계약일</th>
                            <th>건축년도</th>
                            <th>계약구분</th>
                            <th>계약기간</th>
                            <th>종전계약보증금<br>(만원)</th>
                            <th>종전계약월세<br>(만원)</th>
                            <th>갱신요구권사용</th>
                        </tr>
                    </thead>
                    <tbody id="results-tbody">
        `;
    }

    // 데이터 행 추가
    const tbody = append ? document.getElementById('results-tbody') : null;
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
                <td>${row.면적 ? parseFloat(row.면적).toFixed(1) : ''}</td>
                <td>${row.보증금 ? parseInt(row.보증금).toLocaleString() : ''}</td>
                <td>${row.월세 ? parseInt(row.월세).toLocaleString() : ''}</td>
                <td>${row.계약년월 || ''}</td>
                <td>${row.계약일 || ''}</td>
                <td>${row.건축년도 || ''}</td>
                <td>${row.계약구분 || ''}</td>
                <td>${row.계약기간 || ''}</td>
                <td>${row.종전계약보증금 ? parseInt(row.종전계약보증금).toLocaleString() : ''}</td>
                <td>${row.종전계약월세 ? parseInt(row.종전계약월세).toLocaleString() : ''}</td>
                <td>${row.갱신요구권사용 || ''}</td>
            </tr>
        `;
    });

    if (append) {
        // 기존 테이블에 행 추가
        tbody.insertAdjacentHTML('beforeend', rowsHTML);
    } else {
        // 새 테이블 생성
        tableHTML += rowsHTML + `
                    </tbody>
                </table>
            </div>
        `;
        container.innerHTML = tableHTML;

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

// 결과 카운트 업데이트
function updateResultCount() {
    const countElement = document.getElementById('result-count');
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
    document.getElementById('include-apt').checked = true;
    document.getElementById('include-villa').checked = true;
    document.getElementById('include-dagagu').checked = true;
    document.getElementById('include-officetel').checked = true;
    document.getElementById('include-finished').checked = false;
    document.getElementById('include-ongoing').checked = true;

    // 드롭다운 초기화
    document.getElementById('sido').value = '';

    // 입력 필드 초기화
    document.getElementById('area-min').value = '';
    document.getElementById('area-max').value = '';
    document.getElementById('deposit-min').value = '';
    document.getElementById('deposit-max').value = '';
    document.getElementById('rent-min').value = '';
    document.getElementById('rent-max').value = '';
    document.getElementById('build-year-min').value = '';
    document.getElementById('build-year-max').value = '';

    // 시군구, 읍면동 초기화
    document.getElementById('sigungu-checkboxes').innerHTML = '<div class="placeholder-text">시도를 먼저 선택해주세요</div>';
    clearUmds();

    // 결과 초기화
    document.getElementById('result-container').innerHTML = '<div class="no-data">검색 조건을 설정하고 검색 버튼을 눌러주세요.</div>';
    document.getElementById('result-count').textContent = '검색 결과가 없습니다';

    // 페이지네이션 초기화
    currentPage = 1;
    hasMoreData = true;
    currentFilters = null;
    totalCount = 0;
}