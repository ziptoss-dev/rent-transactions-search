// DOM 요소 참조
const elements = {
    aptCheckbox: document.getElementById('apt'),
    villaCheckbox: document.getElementById('villa'),
    dagaguCheckbox: document.getElementById('dagagu'),
    officetelCheckbox: document.getElementById('officetel'),
    contractEnd: document.getElementById('contract-end'),
    sidoSelect: document.getElementById('sido'),
    sigunguCheckboxes: document.getElementById('sigungu-checkboxes'),
    umdCheckboxes: document.getElementById('umd-checkboxes'),
    areaMin: document.getElementById('area-min'),
    areaMax: document.getElementById('area-max'),
    depositMin: document.getElementById('deposit-min'),
    depositMax: document.getElementById('deposit-max'),
    rentMin: document.getElementById('rent-min'),
    rentMax: document.getElementById('rent-max'),
    buildYearMin: document.getElementById('build-year-min'),
    buildYearMax: document.getElementById('build-year-max'),
    searchBtn: document.getElementById('search-btn'),
    resetBtn: document.getElementById('reset-btn'),
    resultTbody: document.querySelector('#results-table tbody'),
    resultCount: document.getElementById('result-count'),
    loading: document.getElementById('loading'),
    errorMessage: document.getElementById('error-message'),
    buildingModal: document.getElementById('building-modal'),
    modalBuildingName: document.getElementById('modal-building-name'),
    modalLoading: document.getElementById('modal-loading'),
    modalError: document.getElementById('modal-error'),
    modalResultsTable: document.querySelector('#modal-results-table tbody'),
    modalClose: document.querySelector('.modal-close')
};

// 현재 선택된 지역 데이터
let currentSigunguData = [];
let currentUmdData = {};

// 무한 스크롤 관련 변수
let currentPage = 1;
let isLoading = false;
let hasMoreData = true;
let currentFilters = null;
let totalCount = 0;

// 초기화
document.addEventListener('DOMContentLoaded', () => {
    loadSidoList();
    setupEventListeners();
    setupModalEventListeners();
    setupInfiniteScroll();
});

// 이벤트 리스너 설정
function setupEventListeners() {
    // 시도 선택 시 시군구 로드
    elements.sidoSelect.addEventListener('change', async () => {
        const sidoCode = elements.sidoSelect.value;
        if (sidoCode) {
            await loadSigunguCheckboxes(sidoCode);
        } else {
            resetSigunguCheckboxes();
            resetUmdCheckboxes();
        }
    });

    // 조회 버튼
    elements.searchBtn.addEventListener('click', () => {
        resetPagination();
        searchTransactions();
    });

    // 초기화 버튼
    elements.resetBtn.addEventListener('click', resetFilters);

    // Enter 키 이벤트
    document.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            resetPagination();
            searchTransactions();
        }
    });
}

// 무한 스크롤 설정
function setupInfiniteScroll() {
    const tableContainer = document.querySelector('.table-container');

    tableContainer.addEventListener('scroll', () => {
        // 스크롤이 거의 끝에 도달했을 때
        if (tableContainer.scrollTop + tableContainer.clientHeight >= tableContainer.scrollHeight - 100) {
            if (!isLoading && hasMoreData && currentFilters) {
                loadMoreData();
            }
        }
    });
}

// 페이지네이션 리셋
function resetPagination() {
    currentPage = 1;
    hasMoreData = true;
    totalCount = 0;
    elements.resultTbody.innerHTML = '';
}

// 추가 데이터 로드
async function loadMoreData() {
    if (isLoading || !hasMoreData) return;

    currentPage++;
    currentFilters.page = currentPage;

    await searchTransactions(true); // append 모드
}

// 모달 이벤트 리스너 설정
function setupModalEventListeners() {
    // 모달 닫기
    elements.modalClose.addEventListener('click', closeModal);

    // 모달 배경 클릭으로 닫기
    elements.buildingModal.addEventListener('click', (e) => {
        if (e.target === elements.buildingModal) {
            closeModal();
        }
    });

    // ESC 키로 모달 닫기
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && elements.buildingModal.style.display === 'flex') {
            closeModal();
        }
    });
}

// 모달 열기
function openModal(buildingName, sggCode, umdName) {
    elements.modalBuildingName.textContent = buildingName;
    elements.buildingModal.style.display = 'flex';
    loadBuildingTransactions(buildingName, sggCode, umdName);
}

// 모달 닫기
function closeModal() {
    elements.buildingModal.style.display = 'none';
    elements.modalError.style.display = 'none';
    elements.modalLoading.style.display = 'none';
    elements.modalResultsTable.innerHTML = '<tr><td colspan="17" class="no-data">건물명을 클릭하여 해당 건물의 실거래가를 조회하세요</td></tr>';
}

// 건물별 실거래가 로드
async function loadBuildingTransactions(buildingName, sggCode, umdName) {
    try {
        // 로딩 표시
        elements.modalLoading.style.display = 'block';
        elements.modalError.style.display = 'none';

        const response = await fetch(`/api/building/${encodeURIComponent(buildingName)}?sgg_code=${sggCode}&umd_name=${encodeURIComponent(umdName)}`);
        const result = await response.json();

        if (result.success) {
            displayModalResults(result.data);
        } else {
            showModalError(result.error || '건물 데이터 조회에 실패했습니다.');
        }
    } catch (error) {
        console.error('건물 조회 오류:', error);
        showModalError('건물 데이터 조회 중 오류가 발생했습니다.');
    } finally {
        elements.modalLoading.style.display = 'none';
    }
}

// 모달 결과 표시
function displayModalResults(data) {
    if (data.length === 0) {
        elements.modalResultsTable.innerHTML = '<tr><td colspan="17" class="no-data">해당 건물의 실거래가 정보가 없습니다.</td></tr>';
        return;
    }

    const rows = data.map(row => {
        let badgeClass, badgeText;
        if (row.source_type === 'apt') {
            badgeClass = 'badge-apt';
            badgeText = '아파트';
        } else if (row.source_type === 'villa') {
            badgeClass = 'badge-villa';
            badgeText = '연립다세대';
        } else if (row.source_type === 'officetel') {
            badgeClass = 'badge-officetel';
            badgeText = '오피스텔';
        } else {
            badgeClass = 'badge-dagagu';
            badgeText = '단독다가구';
        }

        const buildYear = row['건축년도'] ? String(row['건축년도']).split('.')[0] : '-';

        return `
            <tr>
                <td><span class="badge ${badgeClass}">${badgeText}</span></td>
                <td>${row['시도명'] || '-'}</td>
                <td>${row['시군구명'] || '-'}</td>
                <td>${row['읍면동리'] || '-'}</td>
                <td>${row['jibun'] || '-'}</td>
                <td>${row['층'] || '-'}</td>
                <td>${row['계약면적'] || '-'}</td>
                <td>${row['보증금'] || '-'}</td>
                <td>${row['월세금'] || '-'}</td>
                <td>${row['계약년월'] || '-'}</td>
                <td>${row['계약일'] || '-'}</td>
                <td>${buildYear}</td>
                <td>${row['계약구분'] || '-'}</td>
                <td>${row['계약기간'] || '-'}</td>
                <td>${row['종전계약보증금'] || '-'}</td>
                <td>${row['종전계약월세'] || '-'}</td>
                <td>${row['갱신요구권사용'] || '-'}</td>
            </tr>
        `;
    }).join('');

    elements.modalResultsTable.innerHTML = rows;
}

// 모달 에러 표시
function showModalError(message) {
    elements.modalError.textContent = message;
    elements.modalError.style.display = 'block';
}

// 시도 목록 로드
async function loadSidoList() {
    try {
        const response = await fetch('/api/regions/sido');
        const sidoList = await response.json();

        elements.sidoSelect.innerHTML = '<option value="">시도 선택</option>';
        sidoList.forEach(sido => {
            const option = document.createElement('option');
            option.value = sido.code;
            option.textContent = sido.name;
            elements.sidoSelect.appendChild(option);
        });
    } catch (error) {
        console.error('시도 목록 로드 오류:', error);
    }
}

// 시군구 체크박스 로드
async function loadSigunguCheckboxes(sidoCode) {
    try {
        const response = await fetch(`/api/regions/sigungu/${sidoCode}`);
        const sigunguList = await response.json();
        currentSigunguData = sigunguList;

        let html = '<div class="sigungu-controls">';
        html += '<button type="button" class="control-btn" onclick="selectAllSigungu()">모두선택</button>';
        html += '<button type="button" class="control-btn secondary" onclick="deselectAllSigungu()">모두해제</button>';
        html += '</div>';

        sigunguList.forEach(sigungu => {
            html += `
                <label class="checkbox-label">
                    <input type="checkbox" class="sigungu-checkbox" value="${sigungu.code}" onchange="onSigunguChange()">
                    ${sigungu.name}
                </label>
            `;
        });

        elements.sigunguCheckboxes.innerHTML = html;
        resetUmdCheckboxes();
    } catch (error) {
        console.error('시군구 목록 로드 오류:', error);
    }
}

// 시군구 체크박스 변경 시
function onSigunguChange() {
    const checkedSigungu = getCheckedSigungu();
    if (checkedSigungu.length > 0) {
        loadUmdCheckboxes(checkedSigungu);
    } else {
        resetUmdCheckboxes();
    }
}

// 읍면동 체크박스 로드
async function loadUmdCheckboxes(sggCodes) {
    try {
        currentUmdData = {};

        // 여러 시군구의 읍면동 데이터를 병렬로 로드
        const promises = sggCodes.map(async (sggCode) => {
            const response = await fetch(`/api/regions/umd/${sggCode}`);
            const umdList = await response.json();
            currentUmdData[sggCode] = umdList;
            return { sggCode, umdList };
        });

        const results = await Promise.all(promises);
        rebuildUmdCheckboxes();
    } catch (error) {
        console.error('읍면동 목록 로드 오류:', error);
    }
}

// 읍면동 체크박스 재구성
function rebuildUmdCheckboxes() {
    let html = '';

    Object.entries(currentUmdData).forEach(([sggCode, umdList]) => {
        if (umdList.length > 0) {
            const sigunguName = currentSigunguData.find(s => s.code === sggCode)?.name || sggCode;

            html += `
                <div class="sigungu-group">
                    <div class="sigungu-header">
                        <strong>${sigunguName}</strong>
                        <div class="sigungu-controls">
                            <button type="button" class="control-btn" onclick="selectAllUmd('${sggCode}')">모두선택</button>
                            <button type="button" class="control-btn secondary" onclick="deselectAllUmd('${sggCode}')">모두해제</button>
                        </div>
                    </div>
                    <div class="umd-list">
            `;

            umdList.forEach(umd => {
                html += `
                    <label class="checkbox-label">
                        <input type="checkbox" class="umd-checkbox" value="${umd.code}" data-sgg="${sggCode}" checked>
                        ${umd.name}
                    </label>
                `;
            });

            html += '</div></div>';
        }
    });

    if (html) {
        elements.umdCheckboxes.innerHTML = html;
    } else {
        resetUmdCheckboxes();
    }
}

// 실거래가 조회
async function searchTransactions(append = false) {
    // 유효성 검사
    if (!elements.aptCheckbox.checked && !elements.villaCheckbox.checked && !elements.dagaguCheckbox.checked && !elements.officetelCheckbox.checked) {
        showError('주택 유형을 최소 하나 이상 선택해주세요.');
        return;
    }

    const checkedSigungu = getCheckedSigungu();
    const checkedUmd = getCheckedUmd();
    const sidoCode = elements.sidoSelect.value;

    // 시도를 선택했지만 시군구를 아무것도 선택하지 않은 경우 처리
    let finalSggCodes = null;
    let finalUmdCodes = null;

    if (sidoCode && checkedSigungu.length === 0) {
        // 시도만 선택하고 시군구 선택 안함 - 백엔드에서 해당 시도의 모든 시군구 처리
        finalSggCodes = null;
        finalUmdCodes = null;
    } else if (checkedSigungu.length > 0) {
        // 시군구가 선택된 경우
        finalSggCodes = checkedSigungu;
        finalUmdCodes = checkedUmd.length > 0 ? checkedUmd : null;
    }

    // 필터 데이터 수집
    const filters = {
        contract_end: elements.contractEnd.value.trim() || null,
        sido_code: sidoCode || null,
        sgg_codes: finalSggCodes,
        umd_codes: finalUmdCodes,
        area_min: elements.areaMin.value ? parseFloat(elements.areaMin.value) : null,
        area_max: elements.areaMax.value ? parseFloat(elements.areaMax.value) : null,
        deposit_min: elements.depositMin.value ? parseInt(elements.depositMin.value) : null,
        deposit_max: elements.depositMax.value ? parseInt(elements.depositMax.value) : null,
        rent_min: elements.rentMin.value ? parseInt(elements.rentMin.value) : null,
        rent_max: elements.rentMax.value ? parseInt(elements.rentMax.value) : null,
        build_year_min: elements.buildYearMin.value ? parseInt(elements.buildYearMin.value) : null,
        build_year_max: elements.buildYearMax.value ? parseInt(elements.buildYearMax.value) : null,
        include_apt: elements.aptCheckbox.checked,
        include_villa: elements.villaCheckbox.checked,
        include_dagagu: elements.dagaguCheckbox.checked,
        include_officetel: elements.officetelCheckbox.checked,
        page: currentPage,
        page_size: 20
    };

    // 현재 필터 저장
    currentFilters = filters;

    // 로딩 표시
    if (!append) {
        showLoading();
        hideError();
    }
    isLoading = true;

    try {
        const response = await fetch('/api/transactions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(filters)
        });

        const result = await response.json();

        if (result.success) {
            displayResults(result.data, result.count, append, result.page);
            hasMoreData = result.has_more;

            if (!append) {
                totalCount = result.count;
                updateResultCount();
            } else {
                totalCount += result.count;
                updateResultCount();
            }
        } else {
            showError(result.error || '데이터 조회에 실패했습니다.');
        }
    } catch (error) {
        console.error('조회 오류:', error);
        showError('데이터 조회 중 오류가 발생했습니다.');
    } finally {
        hideLoading();
        isLoading = false;
    }
}

// 결과 수 업데이트
function updateResultCount() {
    elements.resultCount.textContent = `${totalCount.toLocaleString()}건${hasMoreData ? '+' : ''}`;
}

// 결과 표시
function displayResults(data, count, append = false, page = 1) {
    if (!append && data.length === 0) {
        elements.resultTbody.innerHTML = '<tr><td colspan="18" class="no-data">조회 결과가 없습니다.</td></tr>';
        return;
    }

    const rows = data.map(row => {
        let badgeClass, badgeText;
        if (row.source_type === 'apt') {
            badgeClass = 'badge-apt';
            badgeText = '아파트';
        } else if (row.source_type === 'villa') {
            badgeClass = 'badge-villa';
            badgeText = '연립다세대';
        } else if (row.source_type === 'officetel') {
            badgeClass = 'badge-officetel';
            badgeText = '오피스텔';
        } else {
            badgeClass = 'badge-dagagu';
            badgeText = '단독다가구';
        }

        // 건축년도 처리 (소수점 제거)
        const buildYear = row['건축년도'] ? String(row['건축년도']).split('.')[0] : '-';

        // 건물명 클릭 가능하게 만들기
        const buildingNameHtml = row['aptnm'] && row['aptnm'] !== '-'
            ? `<span class="building-name-clickable" onclick="openModal('${row['aptnm']}', '${row['sggcd']}', '${row['umdnm']}')">${row['aptnm']}</span>`
            : '-';

        return `
            <tr>
                <td><span class="badge ${badgeClass}">${badgeText}</span></td>
                <td>${row['시도명'] || '-'}</td>
                <td>${row['시군구명'] || '-'}</td>
                <td>${row['읍면동리'] || '-'}</td>
                <td>${row['jibun'] || '-'}</td>
                <td>${buildingNameHtml}</td>
                <td>${row['층'] || '-'}</td>
                <td>${row['계약면적'] || '-'}</td>
                <td>${row['보증금'] || '-'}</td>
                <td>${row['월세금'] || '-'}</td>
                <td>${row['계약년월'] || '-'}</td>
                <td>${row['계약일'] || '-'}</td>
                <td>${buildYear}</td>
                <td>${row['계약구분'] || '-'}</td>
                <td>${row['계약기간'] || '-'}</td>
                <td>${row['종전계약보증금'] || '-'}</td>
                <td>${row['종전계약월세'] || '-'}</td>
                <td>${row['갱신요구권사용'] || '-'}</td>
            </tr>
        `;
    }).join('');

    if (append) {
        elements.resultTbody.insertAdjacentHTML('beforeend', rows);
    } else {
        elements.resultTbody.innerHTML = rows;
    }
}

// 체크된 시군구 가져오기
function getCheckedSigungu() {
    const checkboxes = document.querySelectorAll('.sigungu-checkbox:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

// 체크된 읍면동 가져오기
function getCheckedUmd() {
    const checkboxes = document.querySelectorAll('.umd-checkbox:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

// 시군구 모두 선택
function selectAllSigungu() {
    document.querySelectorAll('.sigungu-checkbox').forEach(cb => cb.checked = true);
    onSigunguChange();
}

// 시군구 모두 해제
function deselectAllSigungu() {
    document.querySelectorAll('.sigungu-checkbox').forEach(cb => cb.checked = false);
    resetUmdCheckboxes();
}

// 특정 시군구의 읍면동 모두 선택
function selectAllUmd(sggCode) {
    document.querySelectorAll(`.umd-checkbox[data-sgg="${sggCode}"]`).forEach(cb => cb.checked = true);
}

// 특정 시군구의 읍면동 모두 해제
function deselectAllUmd(sggCode) {
    document.querySelectorAll(`.umd-checkbox[data-sgg="${sggCode}"]`).forEach(cb => cb.checked = false);
}

// 시군구 체크박스 초기화
function resetSigunguCheckboxes() {
    elements.sigunguCheckboxes.innerHTML = '<div class="placeholder-text">시도를 먼저 선택해주세요</div>';
    currentSigunguData = [];
}

// 읍면동 체크박스 초기화
function resetUmdCheckboxes() {
    elements.umdCheckboxes.innerHTML = '<div class="placeholder-text">시군구를 먼저 선택해주세요</div>';
    currentUmdData = {};
}

// 필터 초기화
function resetFilters() {
    // 체크박스 초기화
    elements.aptCheckbox.checked = true;
    elements.villaCheckbox.checked = true;
    elements.dagaguCheckbox.checked = true;
    elements.officetelCheckbox.checked = true;

    // 입력 필드 초기화
    elements.contractEnd.value = '';
    elements.sidoSelect.value = '';
    elements.areaMin.value = '';
    elements.areaMax.value = '';
    elements.depositMin.value = '';
    elements.depositMax.value = '';
    elements.rentMin.value = '';
    elements.rentMax.value = '';
    elements.buildYearMin.value = '';
    elements.buildYearMax.value = '';

    // 지역 선택 초기화
    resetSigunguCheckboxes();
    resetUmdCheckboxes();

    // 결과 테이블 초기화
    elements.resultTbody.innerHTML = '<tr><td colspan="18" class="no-data">검색 조건을 입력하고 검색 버튼을 클릭해주세요</td></tr>';
    elements.resultCount.textContent = '0건';

    // 페이지네이션 초기화
    resetPagination();
    currentFilters = null;

    hideError();
}

// 로딩 표시
function showLoading() {
    elements.loading.style.display = 'block';
}

// 로딩 숨기기
function hideLoading() {
    elements.loading.style.display = 'none';
}

// 에러 표시
function showError(message) {
    elements.errorMessage.textContent = message;
    elements.errorMessage.style.display = 'block';
}

// 에러 숨기기
function hideError() {
    elements.errorMessage.style.display = 'none';
}