window.themeInterop = {
    get: function () {
        return localStorage.getItem('theme') || 'dark';
    },
    set: function (theme) {
        localStorage.setItem('theme', theme);
        document.documentElement.classList.remove('light', 'dark');
        document.documentElement.classList.add(theme);
    },
    init: function () {
        var theme = localStorage.getItem('theme') || 'dark';
        document.documentElement.classList.remove('light', 'dark');
        document.documentElement.classList.add(theme);
    }
};
window.themeInterop.init();

window.clipboardInterop = {
    copy: async function (text) {
        await navigator.clipboard.writeText(text);
    }
};

window.downloadInterop = {
    download: function (filename, contentType, base64) {
        var link = document.createElement('a');
        link.download = filename;
        link.href = 'data:' + contentType + ';base64,' + base64;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
};

window.highlightCode = function () {
    if (typeof Prism !== 'undefined') {
        Prism.highlightAll();
    }
};

window.focusElement = function (id) {
    var el = document.getElementById(id);
    if (el) el.focus();
};
