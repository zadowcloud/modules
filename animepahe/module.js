/** Animepahe for Sora/Eclipse async JS, version 1.0.2. No DOM, Node APIs or remote eval. */
var Animepahe = (function () {
    var config = {
        baseUrl: 'https://animepahe.pw',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
        // Optional: a valid session for this device/network. Never publish cookies.
        cookie: '',
        pageLimit: 500,
        concurrency: 1,
        searchCacheSeconds: 60
    };
    var searchCache = {}, searchPending = {}, cooldowns = {};

    function log(where, error) {
        console.log('Animepahe ' + where + ': ' + (error.message || String(error)));
    }
    function origin(url) {
        var m = String(url).match(/^https?:\/\/[^/]+/i);
        if (!m) throw new Error('Invalid URL');
        return m[0];
    }
    function absolute(value, base) {
        value = entities(String(value || '').trim());
        if (/^https?:\/\//i.test(value)) return value;
        if (value.indexOf('//') === 0) return 'https:' + value;
        if (!value || /^(?:javascript|data):/i.test(value)) return '';
        return origin(base || config.baseUrl) + '/' + value.replace(/^\//, '');
    }
    function entities(value) {
        var named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—' };
        return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (all, key) {
            if (key[0] !== '#') return named[key.toLowerCase()] || all;
            var n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
            return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
        });
    }
    function text(value) {
        return entities(String(value || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, ' '))
            .replace(/[\t\r ]+/g, ' ').replace(/ *\n */g, '\n').trim();
    }
    function attrs(tag) {
        var out = {}, m, re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
        while ((m = re.exec(tag))) out[m[1].toLowerCase()] = entities(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4]);
        return out;
    }
    function meta(html, name) {
        var tags = html.match(/<meta\b[^>]*>/gi) || [];
        for (var i = 0; i < tags.length; i++) {
            var a = attrs(tags[i]);
            if ((a.property || a.name || '').toLowerCase() === name.toLowerCase()) return a.content || '';
        }
        return '';
    }
    function info(html, label) {
        var m = html.match(new RegExp('<(?:strong|b)[^>]*>\\s*' + label + '\\s*:?\\s*</(?:strong|b)>\\s*([\\s\\S]*?)(?:</p>|</li>|</div>|<br)', 'i'));
        return m ? text(m[1]).replace(/^:\s*/, '') : '';
    }
    function anime(url) {
        var m = String(url).match(/^https?:\/\/(animepahe\.(?:pw|com|si))\/anime\/([a-z0-9-]+)(?:[/?#]|$)/i);
        if (!m) throw new Error('Expected an Animepahe /anime/<session> URL');
        return { base: 'https://' + m[1], id: m[2] };
    }
    async function request(url, referer, json) {
        var host = origin(url);
        if (cooldowns[host] > Date.now()) throw new Error('HTTP 429: Animepahe is temporarily rate limited; wait before retrying.');
        var headers = { 'User-Agent': config.userAgent, Referer: referer || config.baseUrl + '/' };
        if (json) { headers.Accept = 'application/json'; headers['X-Requested-With'] = 'XMLHttpRequest'; }
        if (config.cookie && /^https:\/\/animepahe\.(pw|com|si)(?:\/|$)/i.test(url)) headers.Cookie = config.cookie;
        var response;
        if (typeof fetchv2 === 'function') {
            // Eclipse's fetch is an alias of fetchv2. Retrying through it replays
            // the same failed request and can worsen a source rate limit.
            response = await fetchv2(url, headers, 'GET', null);
        } else if (typeof fetch === 'function') response = await fetch(url, { headers: headers, method: 'GET' });
        else throw new Error('Sora fetch bridge is unavailable');
        if (response == null) throw new Error('Empty network response');
        var status = response.status || response.statusCode || 200;
        var responseHeaders = response.headers || {};
        var body;
        if (typeof response === 'string') body = response;
        else if (typeof response.text === 'function') body = await response.text();
        else if (typeof response.text === 'string') body = response.text;
        else if (typeof response.body === 'string') body = response.body;
        else if (typeof response.data === 'string') body = response.data;
        else throw new Error('Unsupported fetch response shape');
        if (status === 429) {
            var retry = 30;
            var rawRetry = typeof responseHeaders.get === 'function' ? responseHeaders.get('retry-after') : responseHeaders['retry-after'] || responseHeaders['Retry-After'];
            if (rawRetry) {
                var seconds = Number(rawRetry);
                if (isFinite(seconds) && seconds >= 0) retry = Math.max(1, seconds);
                else { var date = Date.parse(rawRetry); if (isFinite(date)) retry = Math.max(1, Math.ceil((date - Date.now()) / 1000)); }
            }
            cooldowns[host] = Date.now() + retry * 1000;
            throw new Error('HTTP 429: Animepahe is temporarily rate limited; retry after ' + retry + ' seconds.');
        }
        // Cloudflare's invisible JavaScript Detection also occurs in normal
        // HTML. Its script URL alone does NOT mean the page is blocked.
        var mitigation = typeof responseHeaders.get === 'function' ? responseHeaders.get('cf-mitigated') : responseHeaders['cf-mitigated'] || responseHeaders['Cf-Mitigated'];
        if (mitigation === 'challenge' || /<title\b[^>]*>\s*(?:Just a moment|Attention Required)|<h[12]\b[^>]*>\s*Sorry, you have been blocked|\bid\s*=\s*["']challenge-(?:form|stage|running)["']/i.test(body))
            throw new Error('Cloudflare blocked this request. Verify site access on your device; this module cannot solve challenges.');
        if (status < 200 || status >= 300) throw new Error('HTTP ' + status + ' from ' + origin(url));
        if (!json) return body;
        var data;
        try { data = JSON.parse(body); } catch (_) { throw new Error('Expected Animepahe JSON; received a non-JSON response'); }
        if (!data || !Array.isArray(data.data)) throw new Error('Animepahe API returned an unexpected schema');
        return data;
    }
    function searchPlan(keyword) {
        var query = String(keyword).replace(/\s*[\[(]?(?:19|20)\d{2}[\])]?(?:\s*)$/, '').trim();
        var apothecary = /^(?:the\s+)?apothecary\s+diaries\b/i.test(query);
        if (apothecary || /^kusuriya\s+no\s+hitorigoto\b/i.test(query)) query = 'Kusuriya no Hitorigoto';
        return { query: query, englishApothecary: apothecary };
    }
    async function searchRows(base, query) {
        var key = base + '/api?m=search&q=' + encodeURIComponent(query.toLowerCase());
        if (searchCache[key] && searchCache[key].expires > Date.now()) return searchCache[key].rows;
        if (searchPending[key]) return await searchPending[key];
        // Fetch one search response. Eclipse already tries title variants;
        // paging every variant exhausted the source's request allowance.
        searchPending[key] = (async function () {
            var response = await request(base + '/api?m=search&q=' + encodeURIComponent(query), base + '/', true);
            var keys = Object.keys(searchCache);
            for (var i = 0; i < keys.length; i++) if (searchCache[keys[i]].expires <= Date.now()) delete searchCache[keys[i]];
            if (Object.keys(searchCache).length >= 20) delete searchCache[Object.keys(searchCache)[0]];
            searchCache[key] = { rows: response.data, expires: Date.now() + config.searchCacheSeconds * 1000 };
            return response.data;
        }());
        try { return await searchPending[key]; }
        finally { delete searchPending[key]; }
    }
    async function episodeRows(item, url) {
        function api(target) {
            return target.base + '/api?m=release&id=' + encodeURIComponent(target.id) + '&sort=episode_asc';
        }
        var failure, rows;
        try {
            rows = await pages(api(item), item.base + '/anime/' + item.id, true);
            if (rows.length) return { item: item, rows: rows };
        } catch (error) {
            // A rate limit or challenge cannot be repaired by more requests.
            if (/HTTP 429|Cloudflare/i.test(error.message || '')) throw error;
            failure = error;
        }
        var html = await request(url, item.base + '/', false);
        var candidates = [], tags = html.match(/<link\b[^>]*>/gi) || [];
        for (var i = 0; i < tags.length; i++) {
            var a = attrs(tags[i]);
            if (/(?:^|\s)canonical(?:\s|$)/i.test(a.rel || '')) candidates.push(absolute(a.href, url));
        }
        candidates.push(absolute(meta(html, 'og:url'), url));
        // Ignore homepage og:url values and foreign origins. Only a different,
        // valid anime session can justify a second release-API request.
        for (var j = 0; j < candidates.length; j++) {
            var canonical;
            try { canonical = anime(candidates[j]); } catch (_) { continue; }
            if (canonical.base !== item.base || canonical.id === item.id) continue;
            return { item: canonical, rows: await pages(api(canonical), url, true) };
        }
        if (failure) throw failure;
        return { item: item, rows: rows || [] };
    }
    async function pages(firstUrl, referer, keepOnRateLimit) {
        var first = await request(firstUrl + '&page=1', referer, true);
        var last = Number(first.last_page || 1);
        if (!isFinite(last) || last < 1 || Math.floor(last) !== last || last > config.pageLimit)
            throw new Error('Invalid or excessive API page count: ' + last);
        var all = first.data.slice();
        for (var p = 2; p <= last; p += config.concurrency) {
            var work = [];
            for (var j = p; j <= last && j < p + config.concurrency; j++) work.push(request(firstUrl + '&page=' + j, referer, true));
            var batch;
            try { batch = await Promise.all(work); }
            catch (error) {
                if (keepOnRateLimit && all.length && /HTTP 429/i.test(error.message || '')) {
                    log('extractEpisodes', new Error('Later episode pages were rate limited. Keeping ' + all.length + ' fetched episodes; later episodes require a retry after the rate limit clears.'));
                    return all;
                }
                throw error;
            }
            for (var k = 0; k < batch.length; k++) all = all.concat(batch[k].data);
        }
        return all;
    }
    function literal(quoted) {
        // Decode JS string literals without executing downloaded JavaScript.
        return quoted.slice(1, -1).replace(/\\(?:u([0-9a-f]{4})|x([0-9a-f]{2})|([\s\S]))/gi, function (_, u, x, c) {
            if (u || x) return String.fromCharCode(parseInt(u || x, 16));
            var escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
            return escapes[c] !== undefined ? escapes[c] : c === '\n' ? '' : c;
        });
    }
    function unpack(source) {
        var quoted = "(\"(?:\\\\[\\s\\S]|[^\"\\\\])*\"|'(?:\\\\[\\s\\S]|[^'\\\\])*')";
        var re = new RegExp('}\\s*\\(\\s*' + quoted + '\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*' + quoted + '\\s*\\.split\\(\\s*[\"\\\']\\|[\"\\\']\\s*\\)', 'g');
        var m, decoded = [];
        while ((m = re.exec(source))) {
            var radix = Number(m[2]), count = Number(m[3]);
            if (radix < 2 || radix > 62 || count > 10000) continue;
            var payload = literal(m[1]), words = literal(m[4]).split('|'), map = {};
            var alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
            for (var i = 0; i < count; i++) {
                var n = i, token = '';
                do { token = alphabet[n % radix] + token; n = Math.floor(n / radix); } while (n > 0);
                if (words[i]) map[token] = words[i];
            }
            decoded.push(payload.replace(/\b\w+\b/g, function (token) { return map[token] || token; }));
        }
        return decoded.join('\n');
    }
    function media(source, base) {
        source = entities(source).replace(/\\\//g, '/').replace(/\\u0026/gi, '&');
        var match = source.match(/(?:https?:)?\/\/[^\s"'<>\\]+\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/i);
        if (match) return absolute(match[0], base);
        match = source.match(/(?:source|file|src)\s*[:=]\s*["'](\/[^"']+\.(?:m3u8|mp4)(?:\?[^"']*)?)["']/i);
        return match ? absolute(match[1], base) : '';
    }
    async function resolve(embed, referer) {
        var html = await request(embed, referer, false);
        for (var i = 0; i < 5; i++) {
            var stream = media(html, embed);
            if (stream) return stream;
            var next = unpack(html);
            if (!next || next === html) break;
            html = next;
        }
        throw new Error('No HLS/MP4 source in Kwik player; its format may have changed');
    }
    function players(html, base) {
        var out = [], seen = {}, tags = html.match(/<(?:button|a|iframe)\b[^>]*>/gi) || [];
        function add(src, a) {
            src = absolute(src, base);
            if (!/^https:\/\/kwik\.(?:cx|si|link|sh)\/e\/[a-z0-9]+(?:[/?#]|$)/i.test(src) || seen[src]) return;
            seen[src] = true;
            out.push({ url: src, resolution: parseInt(a['data-resolution'], 10) || 0,
                audio: a['data-audio'] || 'jpn', fansub: a['data-fansub'] || '', av1: a['data-av1'] === '1' });
        }
        for (var i = 0; i < tags.length; i++) {
            var a = attrs(tags[i]); add(a['data-src'] || a.src || a.href || '', a);
        }
        var re = /https:\/\/kwik\.(?:cx|si|link|sh)\/e\/[a-z0-9]+/gi, m;
        while ((m = re.exec(html))) add(m[0], {});
        return out.sort(function (a, b) { return Number(a.av1) - Number(b.av1) || b.resolution - a.resolution; });
    }
    return { config: config, log: log, anime: anime, absolute: absolute, text: text, meta: meta, info: info,
        request: request, pages: pages, players: players, resolve: resolve, origin: origin, unpack: unpack,
        searchPlan: searchPlan, searchRows: searchRows, episodeRows: episodeRows };
}());

async function searchResults(keyword) {
    try {
        keyword = String(keyword || '').trim();
        if (!keyword) return JSON.stringify([]);
        var base = Animepahe.config.baseUrl.replace(/\/$/, '');
        var plan = Animepahe.searchPlan(keyword);
        var rows = await Animepahe.searchRows(base, plan.query);
        var seen = {}, results = [];
        for (var i = 0; i < rows.length; i++) {
            var item = rows[i];
            if (!item.session || !item.title || seen[item.session]) continue;
            seen[item.session] = true;
            var title = Animepahe.text(item.title);
            if (plan.englishApothecary) title = title.replace(/^Kusuriya\s+no\s+Hitorigoto(?=\s|$)/i, 'The Apothecary Diaries');
            results.push({ title: title, image: Animepahe.absolute(item.poster, base),
                href: base + '/anime/' + encodeURIComponent(item.session) });
        }
        return JSON.stringify(results);
    } catch (error) { Animepahe.log('searchResults', error); return JSON.stringify([]); }
}

async function extractDetails(url) {
    try {
        Animepahe.anime(url);
        var html = await Animepahe.request(url, Animepahe.origin(url) + '/', false);
        var synopsis = html.match(/<div\b[^>]*class\s*=\s*["'][^"']*\banime-synopsis\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
        var aliases = [Animepahe.info(html, 'Japanese'), Animepahe.info(html, 'Synonyms'), Animepahe.info(html, 'English')].filter(function (s) { return !!s; });
        return JSON.stringify({ description: Animepahe.text(synopsis ? synopsis[1] : Animepahe.meta(html, 'description')) || 'No description available.',
            aliases: aliases.join(' / ') || Animepahe.info(html, 'Genre(?:s)?') || '', airdate: Animepahe.info(html, 'Aired') || '' });
    } catch (error) {
        Animepahe.log('extractDetails', error);
        return JSON.stringify({ description: 'Unable to load Animepahe details: ' + error.message, aliases: '', airdate: '' });
    }
}

async function extractEpisodes(url) {
    try {
        var item = Animepahe.anime(url);
        var result = await Animepahe.episodeRows(item, url);
        item = result.item;
        var rows = result.rows;
        var seen = {}, episodes = [];
        rows.sort(function (a, b) { return Number(a.episode) - Number(b.episode) || Number(a.id) - Number(b.id); });
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i], number = parseInt(row.episode, 10);
            if (!row.session || !isFinite(number) || seen[row.session]) continue;
            seen[row.session] = true;
            episodes.push({ href: item.base + '/play/' + encodeURIComponent(item.id) + '/' + encodeURIComponent(row.session), number: number });
        }
        return JSON.stringify(episodes);
    } catch (error) { Animepahe.log('extractEpisodes', error); return JSON.stringify([]); }
}

async function extractStreamUrl(url) {
    try {
        if (!/^https:\/\/animepahe\.(?:pw|com|si)\/play\/[a-z0-9-]+\/[a-z0-9-]+(?:[/?#]|$)/i.test(url))
            throw new Error('Expected an Animepahe /play/<anime>/<episode> URL');
        var html = await Animepahe.request(url, Animepahe.origin(url) + '/', false);
        var players = Animepahe.players(html, url), streams = [], seen = {};
        if (!players.length) throw new Error('No Kwik players found on the Animepahe episode page');
        for (var p = 0; p < players.length; p += Animepahe.config.concurrency) {
            var batch = players.slice(p, p + Animepahe.config.concurrency);
            var resolved = await Promise.all(batch.map(async function (player) {
                try {
                    var stream = await Animepahe.resolve(player.url, url);
                    var audio = player.audio === 'eng' ? 'DUB' : player.audio === 'jpn' ? 'SUB' : player.audio.toUpperCase();
                    return { title: 'Kwik · ' + (player.resolution ? player.resolution + 'p · ' : '') + audio + (player.av1 ? ' · AV1' : '') + (player.fansub ? ' · ' + player.fansub : ''),
                        streamUrl: stream, headers: { Referer: Animepahe.origin(player.url) + '/', 'User-Agent': Animepahe.config.userAgent } };
                } catch (error) { Animepahe.log('Kwik', error); return null; }
            }));
            for (var j = 0; j < resolved.length; j++) {
                if (resolved[j] && !seen[resolved[j].streamUrl]) { seen[resolved[j].streamUrl] = true; streams.push(resolved[j]); }
            }
        }
        if (!streams.length) throw new Error('All Kwik players failed. See the preceding Animepahe logs.');
        return JSON.stringify({ streams: streams });
    } catch (error) { Animepahe.log('extractStreamUrl', error); return JSON.stringify({ streams: [] }); }
}
