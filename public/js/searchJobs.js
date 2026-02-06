// searchJobs.js
// Generic job search that works on pages where job cards are rendered as .job-card
(function(){
    function debounce(fn, wait){
        let t;
        return function(...args){
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    function getCardsContainer(){
        return document.querySelector('.jobs-grid') || document.querySelector('.jobs-list') || document.querySelector('.jobs-scroll') || document.body;
    }

    // runFilter supports an optional selector (to target arbitrary item selectors like .company-item)
    function runFilter(input, selector){
        const q = (input.value || '').toLowerCase().trim();
        let items;
        if (selector) {
            items = document.querySelectorAll(selector);
        } else {
            const container = getCardsContainer();
            items = container.querySelectorAll('.job-card');
        }

        items.forEach(item => {
            const text = (item.textContent || '').toLowerCase();
            if (!q || text.indexOf(q) !== -1) {
                item.style.display = '';
            } else {
                item.style.display = 'none';
            }
        });
    }

    // init accepts an optional options object: { selector: '.company-item' }
    function init(inputId, options){
        const input = document.getElementById(inputId);
        if (!input) return;
        const selector = options && options.selector ? options.selector : null;
        const debounced = debounce(() => runFilter(input, selector), 150);
        input.addEventListener('input', debounced);
        // run initial filter in case input has prefilled value
        runFilter(input, selector);
    }

    // expose to window so pages can call init with their specific input id
    window.jobSearchInit = init;
})();
