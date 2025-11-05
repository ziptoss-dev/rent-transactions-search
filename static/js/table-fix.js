// 테이블 컬럼 너비 강제 적용
document.addEventListener('DOMContentLoaded', function() {
    function fixTableColumns() {
        // 5번째 컬럼 (건물명) - 넓게
        const buildingColumns = document.querySelectorAll('table th:nth-child(5), table td:nth-child(5)');
        buildingColumns.forEach(col => {
            col.style.width = '380px';
            col.style.maxWidth = '380px';
            col.style.minWidth = '380px';
        });

        // 6번째 컬럼 (지번) - 좁게
        const addressColumns = document.querySelectorAll('table th:nth-child(6), table td:nth-child(6)');
        addressColumns.forEach(col => {
            col.style.width = '50px';
            col.style.maxWidth = '50px';
            col.style.minWidth = '50px';
        });
    }

    // 페이지 로드 시 실행
    fixTableColumns();

    // 테이블이 동적으로 업데이트될 때도 실행
    const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.type === 'childList') {
                fixTableColumns();
            }
        });
    });

    // 결과 섹션 감시
    const resultSection = document.querySelector('.result-section');
    if (resultSection) {
        observer.observe(resultSection, { childList: true, subtree: true });
    }
});