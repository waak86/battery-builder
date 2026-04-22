export function showStatus(message, type = 'success') {
    const status = document.getElementById('previewStats');
    if (!status) return;
    status.textContent = message;
    if (type === 'error') {
        status.style.color = '#ef4444';
    } else if (type === 'success') {
        status.style.color = '#10b981';
    } else {
        status.style.color = '#94a3b8';
    }
}

export function showLoading(show, text = 'Generating 3D Model', subtext = 'Please be patient...') {
    const overlay = document.getElementById('loadingOverlay');
    if (!overlay) return;

    const loadingText = document.getElementById('loadingText');
    const loadingSubtext = document.getElementById('loadingSubtext');
    if (loadingText) loadingText.textContent = text;
    if (loadingSubtext) loadingSubtext.textContent = subtext;

    if (show) {
        overlay.classList.add('active');
        overlay.style.display = 'flex';
    } else {
        overlay.classList.remove('active');
        overlay.style.display = 'none';
    }
}

export function toggleBmsDiameter() {
    const bmsType = document.getElementById('bmsHolesType').value;
    const diameterGroup = document.getElementById('bmsHoleDiameterGroup');
    const tabDimsGroup = document.getElementById('tabDimensionsGroup');
    diameterGroup.style.display =
        (bmsType === 'halfcircles' || bmsType === 'fullcircles') ? 'block' : 'none';
    tabDimsGroup.style.display = (bmsType === 'tabs') ? 'grid' : 'none';
}

export function initCustomSelects() {
    const selects = document.querySelectorAll('select');
    selects.forEach(select => {
        const wrapper = document.createElement('div');
        wrapper.className = 'custom-select';
        select.parentNode.insertBefore(wrapper, select);
        wrapper.appendChild(select);

        const selected = document.createElement('div');
        selected.className = 'select-selected';
        selected.textContent = select.options[select.selectedIndex].text;
        wrapper.appendChild(selected);

        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'select-items';
        Array.from(select.options).forEach((option, index) => {
            const item = document.createElement('div');
            item.textContent = option.text;
            item.dataset.value = option.value;
            if (index === select.selectedIndex) item.className = 'same-as-selected';
            item.addEventListener('click', function (e) {
                e.stopPropagation();
                select.selectedIndex = index;
                selected.textContent = this.textContent;
                const prevSelected = itemsContainer.querySelector('.same-as-selected');
                if (prevSelected) prevSelected.classList.remove('same-as-selected');
                this.classList.add('same-as-selected');
                selected.click();
                select.dispatchEvent(new Event('change'));
            });
            itemsContainer.appendChild(item);
        });
        wrapper.appendChild(itemsContainer);

        selected.addEventListener('click', function (e) {
            e.stopPropagation();
            closeAllSelect(this);
            itemsContainer.classList.toggle('show');
            this.classList.toggle('select-arrow-active');
        });
    });
    document.addEventListener('click', closeAllSelect);
}

function closeAllSelect(element) {
    const items = document.querySelectorAll('.select-items');
    const selected = document.querySelectorAll('.select-selected');
    items.forEach((item, index) => {
        if (element !== selected[index]) {
            item.classList.remove('show');
            selected[index].classList.remove('select-arrow-active');
        }
    });
}
