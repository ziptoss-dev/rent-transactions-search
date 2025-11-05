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
    errorMessage: document.getElementById('error-message')
};

// 현재 선택된 지역 데이터
let currentSigunguData = [];
let currentUmdData = {};

// 초기화
document.addEventListener('DOMContentLoaded', () => {
    loadSidoList();
    setupEventListeners();
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
    elements.searchBtn.addEventListener('click', searchTransactions);

    // 초기화 버튼
    elements.resetBtn.addEventListener('click', resetFilters);

    // Enter 키 이벤트
    document.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchTransactions();
        }
    });
}

// 시도 목록 로드
async function loadSidoList() {
    try {
        const response = await fetch('/api/regions/sido');
        const data = await response.json();

        elements.sidoSelect.innerHTML = '<option value="">시도 선택</option>';
        data.forEach(sido => {
            const option = document.createElement('option');
            option.value = sido.code;
            option.textContent = sido.name;
            elements.sidoSelect.appendChild(option);
        });
    } catch (error) {
        console.error('시도 목록 로드 실패:', error);
        showError('시도 목록을 불러오는데 실패했습니다.');
    }
}

// 시군구 체크박스 로드
async function loadSigunguCheckboxes(sidoCode) {
    try {
        const response = await fetch(`/api/regions/sigungu/${sidoCode}`);
        const data = await response.json();
        currentSigunguData = data;

        let html = '';
        data.forEach(sigungu => {
            html += `
                <label class="checkbox-label">
                    <input type="checkbox"
                           data-type="sigungu"
                           data-code="${sigungu.code}"
                           onchange="handleSigunguChange('${sigungu.code}')">
                    <span>${sigungu.name}</span>
                </label>
            `;
        });

        elements.sigunguCheckboxes.innerHTML = html;
        resetUmdCheckboxes();
    } catch (error) {
        console.error('시군구 목록 로드 실패:', error);
        showError('시군구 목록을 불러오는데 실패했습니다.');
    }
}

// 시군구 체크박스 변경 처리
async function handleSigunguChange(sggCode) {
    const checkbox = document.querySelector(`input[data-code="${sggCode}"]`);

    if (checkbox.checked) {
        // 시군구 선택 시 해당 읍면동 로드 및 모두 체크
        await loadUmdForSigungu(sggCode);
    } else {
        // 시군구 해제 시 해당 읍면동 모두 해제
        removeUmdForSigungu(sggCode);
    }
}

// 특정 시군구의 읍면동 로드
async function loadUmdForSigungu(sggCode) {
    try {
        const response = await fetch(`/api/regions/umd/${sggCode}`);
        const data = await response.json();
        currentUmdData[sggCode] = data;

        rebuildUmdCheckboxes();
    } catch (error) {
        console.error('읍면동 목록 로드 실패:', error);
        showError('읍면동 목록을 불러오는데 실패했습니다.');
    }
}

// 특정 시군구의 읍면동 제거
function removeUmdForSigungu(sggCode) {
    delete currentUmdData[sggCode];
    rebuildUmdCheckboxes();
}

// 읍면동 체크박스 재구성
function rebuildUmdCheckboxes() {
    let html = '';

    const checkedSigungu = getCheckedSigungu();
    if (checkedSigungu.length === 0) {
        html = '<div class="placeholder-text">시군구를 먼저 선택해주세요</div>';
    } else {
        checkedSigungu.forEach(sggCode => {
            const sigunguName = currentSigunguData.find(s => s.code === sggCode)?.name || sggCode;
            const umdList = currentUmdData[sggCode] || [];

            html += `
                <div class="sigungu-group">
                    <div class="sigungu-group-header">
                        <span>${sigunguName}</span>
                        <div class="sigungu-controls">
                            <button type="button" class="control-btn" onclick="selectAllUmd('${sggCode}')">모두선택</button>
                            <button type="button" class="control-btn secondary" onclick="deselectAllUmd('${sggCode}')">모두해제</button>
                        </div>
                    </div>
                    <div class="umd-checkboxes">
            `;

            umdList.forEach(umd => {
                html += `
                    <label class="checkbox-label">
                        <input type="checkbox"
                               data-type="umd"
                               data-sigungu="${sggCode}"
                               data-code="${umd.code}"
                               checked>
                        <span>${umd.name}</span>
                    </label>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        });
    }

    elements.umdCheckboxes.innerHTML = html;
}

// 선택된 시군구 코드 반환
function getCheckedSigungu() {
    const checkboxes = document.querySelectorAll('input[data-type="sigungu"]:checked');
    return Array.from(checkboxes).map(cb => cb.dataset.code);
}

// 선택된 읍면동 코드 반환
function getCheckedUmd() {
    const checkboxes = document.querySelectorAll('input[data-type="umd"]:checked');
    return Array.from(checkboxes).map(cb => cb.dataset.code);
}

// 시군구별 읍면동 모두 선택
function selectAllUmd(sggCode) {
    const checkboxes = document.querySelectorAll(`input[data-type="umd"][data-sigungu="${sggCode}"]`);
    checkboxes.forEach(cb => cb.checked = true);
}

// 시군구별 읍면동 모두 해제
function deselectAllUmd(sggCode) {
    const checkboxes = document.querySelectorAll(`input[data-type="umd"][data-sigungu="${sggCode}"]`);
    checkboxes.forEach(cb => cb.checked = false);
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

// 실거래가 조회
async function searchTransactions() {
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
        include_officetel: elements.officetelCheckbox.checked
    };

    // 로딩 표시
    showLoading();
    hideError();

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
            displayResults(result.data, result.count);
        } else {
            showError(result.error || '데이터 조회에 실패했습니다.');
        }
    } catch (error) {
        console.error('조회 오류:', error);
        showError('데이터 조회 중 오류가 발생했습니다.');
    } finally {
        hideLoading();
    }
}

// 결과 표시
function displayResults(data, count) {
    elements.resultCount.textContent = `총 ${count.toLocaleString()}건`;

    if (data.length === 0) {
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

        return `
            <tr>
                <td><span class="badge ${badgeClass}">${badgeText}</span></td>
                <td>${row['시도명'] || '-'}</td>
                <td>${row['시군구명'] || '-'}</td>
                <td>${row['읍면동리'] || '-'}</td>
                <td>${row['지번'] || row['jibun'] || '-'}</td>
                <td>${row['건물명'] || row['mhousename'] || row['aptnm'] || '-'}</td>
                <td>${row['층'] || '-'}</td>
                <td>${formatNumber(row['면적'] || row['계약면적'])}</td>
                <td>${formatMoney(row['보증금'])}</td>
                <td>${formatMoney(row['월세'] || row['월세금'])}</td>
                <td>${formatYearMonth(row['계약년월'])}</td>
                <td>${row['계약일'] || '-'}</td>
                <td>${buildYear}</td>
                <td>${row['계약구분'] || '-'}</td>
                <td>${row['계약기간'] || '-'}</td>
                <td>${formatNumber(row['종전계약보증금'])}</td>
                <td>${formatNumber(row['종전계약월세'])}</td>
                <td>${row['갱신요구권사용'] || '-'}</td>
            </tr>
        `;
    }).join('');

    elements.resultTbody.innerHTML = rows;
}

// 숫자 포맷팅
function formatNumber(value) {
    if (!value || value === '' || value === '-') return '-';
    // 이미 억단위로 포맷팅된 값은 그대로 반환
    if (typeof value === 'string' && value.includes('억')) return value;

    const num = parseFloat(value);
    if (isNaN(num)) return '-';
    return num.toLocaleString();
}

// 금액 포맷팅
function formatMoney(value) {
    if (!value || value === '' || value === '-') return '-';
    // 이미 억단위로 포맷팅된 값은 그대로 반환
    if (typeof value === 'string' && value.includes('억')) return value;

    const num = parseFloat(value);
    if (isNaN(num)) return '-';
    return num.toLocaleString();
}

// 년월 포맷팅 (YYYYMM -> YYYY-MM)
function formatYearMonth(value) {
    if (!value || value.length !== 6) return value || '-';
    return `${value.substring(0, 4)}-${value.substring(4, 6)}`;
}

// 필터 초기화
function resetFilters() {
    elements.aptCheckbox.checked = true;
    elements.villaCheckbox.checked = true;
    elements.dagaguCheckbox.checked = true;
    elements.officetelCheckbox.checked = true;
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
    elements.resultCount.textContent = '0건';
    elements.resultTbody.innerHTML = '<tr><td colspan="18" class="no-data">검색 조건을 입력하고 검색 버튼을 클릭해주세요</td></tr>';

    resetSigunguCheckboxes();
    resetUmdCheckboxes();
    hideError();
}

// 로딩 표시
function showLoading() {
    elements.loading.style.display = 'block';
    elements.searchBtn.disabled = true;
}

// 로딩 숨김
function hideLoading() {
    elements.loading.style.display = 'none';
    elements.searchBtn.disabled = false;
}

// 에러 메시지 표시
function showError(message) {
    elements.errorMessage.textContent = message;
    elements.errorMessage.style.display = 'block';
}

// 에러 메시지 숨김
function hideError() {
    elements.errorMessage.style.display = 'none';
}