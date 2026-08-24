'use strict';

function createHelpPanel(title, sections) {
    let filter = '';
    const safe = (value) => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const render = (target) => {
        const query = filter.trim().toLowerCase();
        const visible = sections.filter((item) => !query || `${item[0]} ${item[1]}`.toLowerCase().includes(query));
        target.innerHTML = visible.length
            ? visible.map((item) => `<article><h2>${safe(item[0])}</h2><p>${safe(item[1])}</p></article>`).join('')
            : '<div class="empty">没有匹配的帮助内容。</div>';
    };
    return {
        template: `<div class="help"><header><h1>${safe(title)}</h1><span>使用帮助</span></header><input id="search" type="search" placeholder="搜索帮助内容"><main id="content"></main></div>`,
        style: `:host{display:flex;min-width:0;min-height:0;color:var(--color-normal-contrast);background:var(--color-normal-fill)}.help{display:flex;flex:1;min-width:0;min-height:0;flex-direction:column;padding:18px;box-sizing:border-box}.help header{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.help h1{margin:0;font-size:17px}.help header span{opacity:.62}.help input{width:100%;height:30px;box-sizing:border-box;margin:16px 0 12px;padding:0 9px;border:1px solid rgba(255,255,255,.16);border-radius:3px;outline:0;color:inherit;background:rgba(0,0,0,.18)}.help main{min-height:0;overflow:auto}.help article{padding:0 0 15px;margin:0 0 15px;border-bottom:1px solid rgba(255,255,255,.09)}.help h2{margin:0 0 7px;font-size:14px}.help p{margin:0;line-height:1.75;color:rgba(255,255,255,.76);overflow-wrap:anywhere}.empty{padding:20px;text-align:center;opacity:.6}`,
        $: { search: '#search', content: '#content' },
        ready() {
            this.$.search.addEventListener('input', () => { filter = this.$.search.value; render(this.$.content); });
            render(this.$.content);
        },
    };
}

module.exports = { createHelpPanel };
