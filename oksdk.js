OKSDK = (function () {
    const SDK_VERSION = false;
    const OK_CONNECT_URL = 'https://connect.ok.ru/';
    const OK_MOB_URL = 'https://m.ok.ru/';
    const OK_API_SERVER = 'https://api.ok.ru/';

    var state = {
        app_id: 0, app_key: '',
        sessionKey: '', accessToken: '', sessionSecretKey: '', apiServer: '', baseUrl: '',
        container: false, header_widget: '',
        sdkToken: '', sdkTokenSecret: ''
    };
    var sdk_success = nop;
    var sdk_failure = nop;
    var rest_counter = 0;

    // ---------------------------------------------------------------------------------------------------
    // General
    // ---------------------------------------------------------------------------------------------------

    /**
     * initializes the SDK<br/>
     * If launch parameters are not detected, switches to OAUTH (via redirect)
     *
     * @param args
     * @param {Number} args.app_id application id
     * @param {String} args.app_key application key
     * @param [args.oauth] - OAUTH configuration
     * @param {String} [args.oauth.scope='VALUABLE_ACCESS'] scope
     * @param {String} [args.oauth.url=location.href] return url
     * @param {String} [args.oauth.state=''] state for security checking
     * @param {Function} success success callback
     * @param {Function} failure failure callback
     */
    function init(args, success, failure) {
        args.oauth = args.oauth || {};
        sdk_success = isFunc(success) ? success : nop;
        sdk_failure = isFunc(failure) ? failure : nop;

        var params = getRequestParameters(args['location_search'] || window.location.search);
        var hParams = getRequestParameters(args['location_hash'] || window.location.hash);

        state.app_id = args.app_id;
        state.app_key = params["application_key"] || args.app_key;
        state.sessionKey = params["session_key"];
        state.accessToken = hParams['access_token'];
        state.sessionSecretKey = params["session_secret_key"] || hParams['session_secret_key'];
        state.apiServer = params["api_server"] || OK_API_SERVER;
        state.baseUrl = state.apiServer + "fb.do";
        state.header_widget = params['header_widget'];
        state.container = params['container'];

        if (!state.app_id || !state.app_key) {
            sdk_failure('Required arguments app_id/app_key not passed');
            return;
        }

        if (!params['api_server']) {
            if ((hParams['access_token'] == null) && (hParams['error'] == null)) {
                window.location = OK_CONNECT_URL + 'oauth/authorize' +
                    '?client_id=' + args['app_id'] +
                    '&scope=' + (args.oauth.scope || 'VALUABLE_ACCESS') +
                    '&response_type=' + 'token' +
                    '&redirect_uri=' + (args.oauth.url || window.location.href) +
                    '&layout=' + 'a' +
                    '&state=' + (args.oauth.state || '');
                return;
            }
            if (hParams['error'] != null) {
                sdk_failure('Error with OAUTH authorization: ' + hParams['error']);
                return;
            }
        }
        if (SDK_VERSION) {
            restCall('sdk.init', {
                    session_data: JSON.stringify({
                        version: 2,
                        client_type: 'SDK_JS',
                        client_version: SDK_VERSION,
                        device_id: navigator.userAgent
                    })
                }, function (status, data, error) {
                    if (status == 'ok') {
                        state.sdkToken = data['session_key'];
                        state.sdkTokenSecret = data['session_secret_key'];
                        sdk_success();
                    } else {
                        sdk_failure("Initialization error: " + toString(error));
                    }
                },
                {no_session: true}
            );
        } else {
            sdk_success();
        }
    }

    // ---------------------------------------------------------------------------------------------------
    // REST
    // ---------------------------------------------------------------------------------------------------

    function restLoad(url) {
        var script = document.createElement('script');
        script.src = url;
        script.async = true;
        var done = false;
        script.onload = script.onreadystatechange = function () {
            if (!done && (!this.readyState || this.readyState === "loaded" || this.readyState === "complete")) {
                done = true;
                script.onload = null;
                script.onreadystatechange = null;
                if (script && script.parentNode) {
                    script.parentNode.removeChild(script);
                }
            }
        };
        var headElem = document.getElementsByTagName('head')[0];
        headElem.appendChild(script);
    }

    /**
     * Calls a REST request
     *
     * @param {String} method
     * @param {Object} [params]
     * @param {restCallback} [callback]
     * @param {Object} [callOpts]
     * @returns {string}
     */
    function restCall(method, params, callback, callOpts) {
        var query = "?";
        params = params || {};
        params.method = method;
        params = restFillParams(params);
        if (callOpts && callOpts.no_session) {
            delete params['session_key'];
            delete params['access_token'];
        } else {
            params['sig'] = calcSignature(params, state.sessionSecretKey);
        }

        for (var key in params) {
            if (params.hasOwnProperty(key)) {
                query += key + "=" + encodeURIComponent(params[key]) + "&";
            }
        }
        var callbackId = "__oksdk__callback_" + (++rest_counter);
        window[callbackId] = function (status, data, error) {
            if (isFunc(callback)) {
                callback(status, data, error);
            }
            window[callbackId] = null;
            try {
                delete window[callbackId];
            } catch (e) {}
        };
        restLoad(state.baseUrl + query + "js_callback=" + callbackId);
        return callbackId;
    }

    function calcSignatureExternal(query) {
        return calcSignature(restFillParams(query));
    }

    function calcSignature(query) {
        var i, keys = [];
        for (i in query) {
            keys.push(i.toString());
        }
        keys.sort();
        var sign = "";
        for (i = 0; i < keys.length; i++) {
            var key = keys[i];
            if (("sig" != key) && ("access_token" != key)) {
                sign += keys[i] + '=' + query[keys[i]];
            }
        }
        sign += state.sessionSecretKey;
        sign = encodeUtf8(sign);
        return md5(sign);
    }

    function restFillParams(params) {
        params = params || {};
        params["application_key"] = state.app_key;
        if (state.sessionKey) {
            params["session_key"] = state.sessionKey;
        } else {
            params["access_token"] = state.accessToken;
        }
        params["format"] = 'JSON';
        return params;
    }

    function wrapCallback(success, failure, dataProcessor) {
        return function(status, data, error) {
            if (status == 'ok') {
                if (isFunc(success)) success(isFunc(dataProcessor) ? dataProcessor(data) : data);
            } else {
                if (isFunc(failure)) failure(error);
            }
        };
    }

    // ---------------------------------------------------------------------------------------------------
    // Payment
    // ---------------------------------------------------------------------------------------------------

    function paymentShow(productName, productPrice, productCode) {
        var params = {};
        params['name'] = productName;
        params['price'] = productPrice;
        params['code'] = productCode;

        params["application_key"] = state.app_key;
        if (state.sessionKey) {
            params["session_key"] = state.sessionKey;
        } else {
            params["access_token"] = state.accessToken;
        }
        params['sig'] = calcSignature(params, state.sessionSecretKey);

        var query = OK_MOB_URL + 'api/show_payment?';
        for (var key in params) {
            if (params.hasOwnProperty(key)) {
                query += key + "=" + encodeURIComponent(params[key]) + "&";
            }
        }

        window.open(query);
    }

    // ---------------------------------------------------------------------------------------------------
    // Widgets
    // ---------------------------------------------------------------------------------------------------

    /**
     * Returns HTML to be used as a back button for mobile app<br/>
     * If back button is required (like js app opened in browser from native mobile app) the required html
     * will be returned in #onSucсess callback
     * @param {onSuccessCallback} onSuccess
     * @param {String} [style]
     */
    function widgetBackButton(onSuccess, style) {
        if (state.container || state.accessToken) return;
        restCall('widget.getWidgetContent',
            {wid: state.header_widget || 'mobile-header-small', style: style || null},
            wrapCallback(onSuccess, null, function(data) {
                return decodeUtf8(atob(data))
            }));
    }

    function widgetMediatopicPost(returnUrl, feed) {
        widgetOpen('WidgetMediatopicPost', {feed: feed}, returnUrl);
    }

    function widgetInvite(returnUrl) {
        widgetOpen('WidgetInvite', '', returnUrl);
    }

    function widgetSuggest(returnUrl) {
        widgetOpen('WidgetSuggest', '', returnUrl);
    }

    function widgetOpen(widget, args, returnUrl) {
        args = args || {};

        var sigSource = '';
        if (args.feed != null) {
            sigSource += 'st.attachment=' + args.feed;
        }
        sigSource += 'st.return=' + returnUrl + state.sessionSecretKey;

        var query = OK_CONNECT_URL + 'dk?st.cmd=' + widget + '&st.app=' + state.app_id;
        if (args.feed != null) {
            query += '&st.attachment=' + encodeURIComponent(args.feed);
        }
        query += '&st.signature=' + md5(sigSource);
        query += '&st.return=' + encodeURIComponent(returnUrl);
        if (state.accessToken != null) {
            query += '&st.access_token=' + state.accessToken;
        }
        if (state.sessionKey) {
            query += '&st.session_key=' + state.sessionKey;
        }
        window.open(query);
    }

    // ---------------------------------------------------------------------------------------------------
    // Utils
    // ---------------------------------------------------------------------------------------------------

    /**
     * calculates md5 of a string
     * @param {String} str
     * @returns {String}
     */
    function md5(str) {
        var hex_chr = "0123456789abcdef";

        function rhex(num) {
            var str = "";
            for (var j = 0; j <= 3; j++) {
                str += hex_chr.charAt((num >> (j * 8 + 4)) & 0x0F) + hex_chr.charAt((num >> (j * 8)) & 0x0F);
            }
            return str;
        }

        function str2blks_MD5(str) {
            var nblk = ((str.length + 8) >> 6) + 1;
            var blks = new Array(nblk * 16);
            for (var i = 0; i < nblk * 16; i++) {
                blks[i] = 0;
            }
            for (i = 0; i < str.length; i++) {
                blks[i >> 2] |= str.charCodeAt(i) << ((i % 4) * 8);
            }
            blks[i >> 2] |= 0x80 << ((i % 4) * 8);
            blks[nblk * 16 - 2] = str.length * 8;
            return blks;
        }

        function add(x, y) {
            var lsw = (x & 0xFFFF) + (y & 0xFFFF);
            var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
            return (msw << 16) | (lsw & 0xFFFF);
        }

        function rol(num, cnt) {
            return (num << cnt) | (num >>> (32 - cnt));
        }

        function cmn(q, a, b, x, s, t) {
            return add(rol(add(add(a, q), add(x, t)), s), b);
        }

        function ff(a, b, c, d, x, s, t) {
            return cmn((b & c) | ((~b) & d), a, b, x, s, t);
        }

        function gg(a, b, c, d, x, s, t) {
            return cmn((b & d) | (c & (~d)), a, b, x, s, t);
        }

        function hh(a, b, c, d, x, s, t) {
            return cmn(b ^ c ^ d, a, b, x, s, t);
        }

        function ii(a, b, c, d, x, s, t) {
            return cmn(c ^ (b | (~d)), a, b, x, s, t);
        }

        var x = str2blks_MD5(str);
        var a = 1732584193;
        var b = -271733879;
        var c = -1732584194;
        var d = 271733878;

        for (var i = 0; i < x.length; i += 16) {
            var olda = a;
            var oldb = b;
            var oldc = c;
            var oldd = d;

            a = ff(a, b, c, d, x[i + 0], 7, -680876936);
            d = ff(d, a, b, c, x[i + 1], 12, -389564586);
            c = ff(c, d, a, b, x[i + 2], 17, 606105819);
            b = ff(b, c, d, a, x[i + 3], 22, -1044525330);
            a = ff(a, b, c, d, x[i + 4], 7, -176418897);
            d = ff(d, a, b, c, x[i + 5], 12, 1200080426);
            c = ff(c, d, a, b, x[i + 6], 17, -1473231341);
            b = ff(b, c, d, a, x[i + 7], 22, -45705983);
            a = ff(a, b, c, d, x[i + 8], 7, 1770035416);
            d = ff(d, a, b, c, x[i + 9], 12, -1958414417);
            c = ff(c, d, a, b, x[i + 10], 17, -42063);
            b = ff(b, c, d, a, x[i + 11], 22, -1990404162);
            a = ff(a, b, c, d, x[i + 12], 7, 1804603682);
            d = ff(d, a, b, c, x[i + 13], 12, -40341101);
            c = ff(c, d, a, b, x[i + 14], 17, -1502002290);
            b = ff(b, c, d, a, x[i + 15], 22, 1236535329);

            a = gg(a, b, c, d, x[i + 1], 5, -165796510);
            d = gg(d, a, b, c, x[i + 6], 9, -1069501632);
            c = gg(c, d, a, b, x[i + 11], 14, 643717713);
            b = gg(b, c, d, a, x[i + 0], 20, -373897302);
            a = gg(a, b, c, d, x[i + 5], 5, -701558691);
            d = gg(d, a, b, c, x[i + 10], 9, 38016083);
            c = gg(c, d, a, b, x[i + 15], 14, -660478335);
            b = gg(b, c, d, a, x[i + 4], 20, -405537848);
            a = gg(a, b, c, d, x[i + 9], 5, 568446438);
            d = gg(d, a, b, c, x[i + 14], 9, -1019803690);
            c = gg(c, d, a, b, x[i + 3], 14, -187363961);
            b = gg(b, c, d, a, x[i + 8], 20, 1163531501);
            a = gg(a, b, c, d, x[i + 13], 5, -1444681467);
            d = gg(d, a, b, c, x[i + 2], 9, -51403784);
            c = gg(c, d, a, b, x[i + 7], 14, 1735328473);
            b = gg(b, c, d, a, x[i + 12], 20, -1926607734);

            a = hh(a, b, c, d, x[i + 5], 4, -378558);
            d = hh(d, a, b, c, x[i + 8], 11, -2022574463);
            c = hh(c, d, a, b, x[i + 11], 16, 1839030562);
            b = hh(b, c, d, a, x[i + 14], 23, -35309556);
            a = hh(a, b, c, d, x[i + 1], 4, -1530992060);
            d = hh(d, a, b, c, x[i + 4], 11, 1272893353);
            c = hh(c, d, a, b, x[i + 7], 16, -155497632);
            b = hh(b, c, d, a, x[i + 10], 23, -1094730640);
            a = hh(a, b, c, d, x[i + 13], 4, 681279174);
            d = hh(d, a, b, c, x[i + 0], 11, -358537222);
            c = hh(c, d, a, b, x[i + 3], 16, -722521979);
            b = hh(b, c, d, a, x[i + 6], 23, 76029189);
            a = hh(a, b, c, d, x[i + 9], 4, -640364487);
            d = hh(d, a, b, c, x[i + 12], 11, -421815835);
            c = hh(c, d, a, b, x[i + 15], 16, 530742520);
            b = hh(b, c, d, a, x[i + 2], 23, -995338651);

            a = ii(a, b, c, d, x[i + 0], 6, -198630844);
            d = ii(d, a, b, c, x[i + 7], 10, 1126891415);
            c = ii(c, d, a, b, x[i + 14], 15, -1416354905);
            b = ii(b, c, d, a, x[i + 5], 21, -57434055);
            a = ii(a, b, c, d, x[i + 12], 6, 1700485571);
            d = ii(d, a, b, c, x[i + 3], 10, -1894986606);
            c = ii(c, d, a, b, x[i + 10], 15, -1051523);
            b = ii(b, c, d, a, x[i + 1], 21, -2054922799);
            a = ii(a, b, c, d, x[i + 8], 6, 1873313359);
            d = ii(d, a, b, c, x[i + 15], 10, -30611744);
            c = ii(c, d, a, b, x[i + 6], 15, -1560198380);
            b = ii(b, c, d, a, x[i + 13], 21, 1309151649);
            a = ii(a, b, c, d, x[i + 4], 6, -145523070);
            d = ii(d, a, b, c, x[i + 11], 10, -1120210379);
            c = ii(c, d, a, b, x[i + 2], 15, 718787259);
            b = ii(b, c, d, a, x[i + 9], 21, -343485551);

            a = add(a, olda);
            b = add(b, oldb);
            c = add(c, oldc);
            d = add(d, oldd);
        }
        return rhex(a) + rhex(b) + rhex(c) + rhex(d);
    }

    function isFunc(obj) {
        return Object.prototype.toString.call(obj) === "[object Function]";
    }

    function isString(obj) {
        return Object.prototype.toString.call(obj) === "[object String]";
    }

    function toString(obj) {
        return isString(obj) ? obj : JSON.stringify(obj);
    }

    /**
     * Parses parameters to a JS map<br/>
     * Supports both window.location.search and window.location.hash)
     * @param {String} [source=window.location.search] string to parse
     * @returns {Object}
     */
    function getRequestParameters(source) {
        var res = {};
        var url = source || window.location.search;
        if (url) {
            url = url.substr(1);    // Drop the leading '?' / '#'
            var nameValues = url.split("&");

            for (var i = 0; i < nameValues.length; i++) {
                var nameValue = nameValues[i].split("=");
                var name = nameValue[0];
                var value = nameValue[1];
                value = decodeURIComponent(value.replace(/\+/g, " "));
                res[name] = value;
            }
        }
        return res;
    }

    function encodeUtf8(string) {
        var res = "";
        for (var n = 0; n < string.length; n++) {
            var c = string.charCodeAt(n);
            if (c < 128) {
                res += String.fromCharCode(c);
            }
            else if ((c > 127) && (c < 2048)) {
                res += String.fromCharCode((c >> 6) | 192);
                res += String.fromCharCode((c & 63) | 128);
            }
            else {
                res += String.fromCharCode((c >> 12) | 224);
                res += String.fromCharCode(((c >> 6) & 63) | 128);
                res += String.fromCharCode((c & 63) | 128);
            }
        }
        return res;
    }

    function decodeUtf8(utftext) {
        var string = "";
        var i = 0;
        var c = 0, c2 = 0, c3 = 0;
        while (i < utftext.length) {
            c = utftext.charCodeAt(i);
            if (c < 128) {
                string += String.fromCharCode(c);
                i++;
            }
            else if ((c > 191) && (c < 224)) {
                c2 = utftext.charCodeAt(i + 1);
                string += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
                i += 2;
            } else {
                c2 = utftext.charCodeAt(i + 1);
                c3 = utftext.charCodeAt(i + 2);
                string += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
                i += 3;
            }
        }
        return string;
    }

    /** stub func */
    function nop() {}

    /**
     * @callback onSuccessCallback
     * @param {String} result
     */

    /**
     * @callback restCallback
     * @param {String} code (either 'ok' or 'error')
     * @param {Object} data success data
     * @param {Object} error error data
     */

    // ---------------------------------------------------------------------------------------------------
    return {
        init: init,
        REST: {
            call: restCall,
            calcSignature: calcSignatureExternal
        },
        Payment: {
            show: paymentShow
        },
        Widgets: {
            getBackButtonHtml: widgetBackButton,
            post: widgetMediatopicPost,
            invite: widgetInvite,
            suggest: widgetSuggest
        },
        Util: {
            md5: md5,
            encodeUtf8: encodeUtf8,
            decodeUtf8: decodeUtf8,
            encodeBase64: btoa,
            decodeBase64: atob,
            toString: toString
        }
    };
})();