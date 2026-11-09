/** MKissa for Sora/Eclipse 1.0.0. SUB sources, portable JavaScriptCore runtime.
 * Public client protocol: MKissa build 186 (2026-11-09).
 * No remote evaluation, embedded session cookies, Node, DOM or native crypto dependency.
 */
var MKissa = (function () {
    var BASE = 'https://mkissa.to', API = 'https://api.mkissa.net', PLAYER = 'https://allanime.day';
    var UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
    var CLIENT = {build:'186',lane:'k7',blocks:['1KCP6HH4CIw=','AKst81/pPjI=','5DdlrLuAeF0=','Kgtk2A3ZOVk='],saltMul:234,saltAdd:35,fragMul:187,fragAdd:64,prefix:'1fwWJAeMU:',join:'+',parts:['buildId','host','group','lane','epoch']};
    var EPISODE_QUERY = "query($showId:String!,$translationType:VaildTranslationTypeEnumType!,$episodeString:String!){episode(showId:$showId,translationType:$translationType,episodeString:$episodeString){episodeString sourceUrls show{_id name} episodeInfo{notes}}}";
    var keysCache = null, streamCache = {}, showCache = {}, blockedUntil = 0;
    function log(where,e){console.log('MKissa '+where+': '+(e.message||String(e)));}
    function headers(){return {'User-Agent':UA,'Origin':BASE,'Referer':BASE+'/','Accept':'application/json','Content-Type':'application/json'};}
    async function request(url,method,body,extra){
        if(Date.now()<blockedUntil)throw new Error('Source rate limited; wait before retrying');
        var h=headers();Object.keys(extra||{}).forEach(function(k){h[k]=extra[k];});
        var r;
        if(typeof fetchv2==='function')r=await fetchv2(url,h,method||'GET',body==null?null:body);
        else if(typeof fetch==='function')r=await fetch(url,{headers:h,method:method||'GET',body:body==null?undefined:body});
        else throw new Error('Fetch bridge unavailable');
        if(r==null)throw new Error('Empty network response');
        var status=r.status||r.statusCode||200;
        var text=typeof r==='string'?r:typeof r.text==='function'?await r.text():typeof r.text==='string'?r.text:typeof r.body==='string'?r.body:r.data;
        if(typeof text!=='string')throw new Error('Unsupported network response');
        if(status===429){blockedUntil=Date.now()+60000;throw new Error('HTTP 429; retry in one minute');}
        if(status>=400)throw new Error('HTTP '+status+' from '+url.split('/')[2]);
        if(/<title[^>]*>\s*(?:Just a moment|Attention Required)/i.test(text))throw new Error('Source requires browser verification');
        return text;
    }
    async function json(url,method,body,extra){
        var text=await request(url,method,body,extra);
        try{return JSON.parse(text);}catch(e){throw new Error('Non-JSON response from '+url.split('/')[2]);}
    }
    async function gql(query,variables,extensions,extra){
        var payload={query:query,variables:variables||{}};if(extensions)payload.extensions=extensions;
        var j=await json(API+'/api','POST',JSON.stringify(payload),extra);
        if(j.errors&&j.errors.length){
            var message=j.errors.map(function(e){return e.message||'API error';}).join('; ');
            if(/Too many|try again in/i.test(message)){
                var wait=message.match(/(\d+)\s*seconds/i);blockedUntil=Date.now()+Math.max(1,wait?Number(wait[1]):60)*1000;
            }
            // Do not disguise a challenge, stale protocol, or rate limit as a playable source.
            throw new Error(message);
        }
        if(!j.data)throw new Error('API response has no data');return j.data;
    }
    function showId(url){var m=String(url).match(/^https:\/\/mkissa\.to\/anime\/([A-Za-z0-9]+)(?:[/?#]|$)/);if(!m)throw new Error('Expected an MKissa anime URL');return m[1];}
    function episode(url){
        var id=showId(url),m=String(url).match(/\/p-(\d+)-sub(?:[?#]|$)/);
        if(!m)throw new Error('Expected an MKissa SUB episode URL');return {id:id,number:m[1]};
    }
    function clean(s){return String(s||'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/[ \t]+/g,' ').trim();}
    function image(s){if(!s)return '';if(/^https?:\/\//.test(s))return s;if(s.indexOf('//')===0)return 'https:'+s;return 'https://wp.youtube-anime.com/aln.youtube-anime.com/'+s.replace(/^\//,'');}
    async function show(id){
        if(showCache[id]&&Date.now()-showCache[id].time<60000)return showCache[id].data;
        var d=await gql('query($id:String!){show(_id:$id){_id name englishName nativeName description altNames genres season airedStart availableEpisodesDetail}}',{id:id});
        if(!d.show)throw new Error('Show not found');showCache[id]={time:Date.now(),data:d.show};return d.show;
    }
    async function search(keyword){
        var term=decodeURIComponent(encodeURIComponent(String(keyword||'').trim()));if(!term)return [];
        var d=await gql('query($search:SearchInput,$limit:Int,$page:Int){shows(search:$search,limit:$limit,page:$page){edges{_id name englishName thumbnail availableEpisodes}}}',{search:{query:term,allowAdult:false,allowUnknown:false},limit:40,page:1});
        var rows=(d.shows&&d.shows.edges)||[];
        function rank(s){var n=String(s.englishName||s.name||'').toLowerCase().replace(/^the /,''),q=term.toLowerCase().replace(/^the /,'');return n===q?0:n.indexOf(q)===0?1:2;}
        rows.sort(function(a,b){return rank(a)-rank(b);});
        return rows.filter(function(s){return s._id&&(!s.availableEpisodes||Number(s.availableEpisodes.sub)>0);}).map(function(s){return {title:s.englishName||s.name,image:image(s.thumbnail),href:BASE+'/anime/'+encodeURIComponent(s._id)};});
    }
    async function details(url){
        var s=await show(showId(url)),names=[s.name,s.englishName,s.nativeName].concat(s.altNames||[]).filter(function(v){return typeof v==='string'&&v;});
        names=names.filter(function(v,i){return names.indexOf(v)===i;});
        var date=s.airedStart||s.season||{},year=typeof date==='object'?date.year:date;
        return {description:clean(s.description)||'No description available.',aliases:names.join(' / ')||(s.genres||[]).join(', '),airdate:year?String(year):''};
    }
    async function episodes(url){
        var id=showId(url),s=await show(id),list=(s.availableEpisodesDetail&&s.availableEpisodesDetail.sub)||[],seen={};
        return list.filter(function(n){if(!/^\d+$/.test(String(n))||seen[Number(n)])return false;seen[Number(n)]=true;return true;}).map(function(n){return {href:BASE+'/anime/'+id+'/p-'+encodeURIComponent(String(n))+'-sub',number:parseInt(n,10)};}).sort(function(a,b){return a.number-b.number;});
    }
    function mask(){
        var embedded=new Uint8Array(32);CLIENT.blocks.forEach(function(b,i){embedded.set(MKCrypto.unb64(b),i*8);});
        var out=new Uint8Array(32);
        for(var i=0;i<32;i++)out[i]=embedded[i]^CLIENT.build.charCodeAt(i%CLIENT.build.length)^((i*CLIENT.saltMul+CLIENT.saltAdd)&255)^(((i>>3)*CLIENT.fragMul+(i%8)*CLIENT.fragAdd)&255);
        return out;
    }
    async function keys(){
        if(keysCache&&Date.now()-keysCache.time<60000)return keysCache;
        var now=Date.now(),epoch=Math.floor(now/604800000);if(now-epoch*604800000<86400000&&epoch>0)epoch--;
        var m=mask(),hkey=MKCrypto.hmac(m,MKCrypto.bytes(CLIENT.prefix+CLIENT.build));
        var parts={buildId:CLIENT.build,host:'mkissa.to',group:'mkissa',lane:CLIENT.lane,epoch:String(epoch)};
        var message=CLIENT.parts.map(function(k){return parts[k];}).join(CLIENT.join);
        var boot=MKCrypto.hex(MKCrypto.hmac(hkey,MKCrypto.bytes(message)));
        var d=await json(API+'/client-crypto/v1/bootstrap?buildId='+encodeURIComponent(CLIENT.build)+'&k='+encodeURIComponent(CLIENT.lane),'GET',null,{'x-build-id':CLIENT.build,'x-aa-boot':boot});
        if(!d.partB||d.epoch==null)throw new Error('Unsupported client bootstrap; module protocol may need updating');
        var raw=MKCrypto.unb64(d.partB);if(raw.length<32)throw new Error('Short bootstrap response');
        var key=new Uint8Array(32);for(var i=0;i<32;i++)key[i]=raw[i]^m[i];
        keysCache={time:Date.now(),key:key,epoch:d.epoch,lane:d.k||CLIENT.lane};return keysCache;
    }
    async function sources(ep){
        var k=await keys(),qh=MKCrypto.hex(MKCrypto.sha256(MKCrypto.bytes(EPISODE_QUERY))),ts=Math.floor(Date.now()/300000)*300000;
        var payload=JSON.stringify({v:1,ts:ts,epoch:k.epoch,buildId:CLIENT.build,qh:qh,k:k.lane});
        var iv=MKCrypto.sha256(MKCrypto.bytes(k.epoch+':'+CLIENT.build+':'+qh+':'+ts+':'+k.lane)).slice(0,12);
        var token=MKCrypto.b64(MKCrypto.concat(MKCrypto.concat(new Uint8Array([1]),iv),MKCrypto.seal(k.key,iv,MKCrypto.bytes(payload))));
        var d=await gql(EPISODE_QUERY,{showId:ep.id,translationType:'sub',episodeString:ep.number},{persistedQuery:{version:1,sha256Hash:qh},aaReq:token,k:k.lane},{'x-build-id':CLIENT.build});
        if(d.tobeparsed){
            var raw=MKCrypto.unb64(d.tobeparsed);if(raw.length<30||raw[0]!==1)throw new Error('Unsupported episode envelope');
            d=JSON.parse(MKCrypto.string(MKCrypto.open(k.key,raw.slice(1,13),raw.slice(13))));
        }
        if(!d.episode)throw new Error('Episode not found');return d.episode.sourceUrls||[];
    }
    function decodedSource(value){
        var masks={'--':56},prefix=value.slice(0,2);
        if(prefix!=='--')return value;
        var h=value.slice(2);if(h.length%2||!/^[0-9a-f]+$/i.test(h))throw new Error('Invalid encoded source');
        var s='';for(var i=0;i<h.length;i+=2)s+=String.fromCharCode(parseInt(h.slice(i,i+2),16)^masks[prefix]);return s;
    }
    function absolute(value,base){
        if(/^https?:\/\//i.test(value))return value;if(value.indexOf('//')===0)return 'https:'+value;
        var origin=String(base).match(/^https?:\/\/[^/]+/)[0];if(value[0]==='/')return origin+value;
        return base.split('?')[0].replace(/[^/]*$/,'')+value;
    }
    function media(value){return typeof value==='string'&&/^https?:\/\//i.test(value)&&!/['"<>\s]/.test(value)&&/\.(mp4|m3u8)(?:[?#]|$)/i.test(value);}
    function item(value,name,referer){return {title:'SUB · '+name,streamUrl:value,headers:{'Referer':referer,'User-Agent':UA}};}
    async function resolve(src){
        var u=decodedSource(src.sourceUrl||''),name=src.sourceName||'Source',out=[];
        if(u.indexOf('/apivtwo/')===0||u.indexOf('/apivthree/')===0){
            u=PLAYER+u.replace(/\/clock(?=[?]|$)/,'/clock.json');
            var data=await json(u,'GET',null,{'Referer':PLAYER+'/'});
            (data.links||[]).forEach(function(l){
                // A separate subtitle track is unsuitable for the requested hardsub module.
                if(!media(l.link)||(l.subtitles&&l.subtitles.length))return;
                var quality=l.resolutionStr||l.resolution|| (l.hls?'HLS':'MP4');
                var stream=item(l.link,name+' '+quality,PLAYER+'/');
                if(l.headers&&typeof l.headers==='object')Object.keys(l.headers).forEach(function(k){stream.headers[k]=l.headers[k];});
                out.push(stream);
            });return out;
        }
        if(media(u))return [item(u,name,BASE+'/')];
        if(!/^https?:\/\/(?:www\.)?(?:mp4upload\.com|ok\.ru)\//i.test(u))return [];
        var html=await request(u,'GET',null,{'Referer':BASE+'/','Accept':'text/html'});
        if(/mp4upload\.com/i.test(u)){
            var m=html.match(/(?:src|file)\s*[:=]\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);
            if(m&&media(m[1]))out.push(item(m[1],name,u));
        }else{
            var attr=html.match(/data-options\s*=\s*"([^"]+)"/i);
            if(attr){
                var options=JSON.parse(attr[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&#39;/g,"'"));
                var metadata=options.flashvars&&options.flashvars.metadata;
                if(typeof metadata==='string')metadata=JSON.parse(metadata);
                if(metadata){
                    if(media(metadata.ondemandHls))out.push(item(metadata.ondemandHls,name+' HLS',u));
                    (metadata.videos||[]).forEach(function(v){
                        if(!v.disallowed&&typeof v.url==='string'&&/^https:\/\/(?:[^/]+\.)?okcdn\.ru\//i.test(v.url)&&!/[\s'"<>]/.test(v.url))out.push(item(v.url,name+' '+(v.name||'MP4'),u));
                    });
                }
            }
        }
        return out;
    }
    async function streams(url){
        var ep=episode(url),cache=streamCache[url];if(cache&&Date.now()-cache.time<30000)return cache.value;
        var list=await sources(ep);list=list.filter(function(s){return s&&s.sourceUrl;}).sort(function(a,b){return (b.priority||0)-(a.priority||0);});
        var out=[],seen={};
        // Internal servers are preferred; external hosts are fallbacks, avoiding expired/deleted embeds.
        for(var i=0;i<list.length;i++){
            try{
                var rows=await resolve(list[i]);rows.forEach(function(s){if(!seen[s.streamUrl]){seen[s.streamUrl]=true;out.push(s);}});
                if(out.length)break;
            }catch(e){log(list[i].sourceName||'server',e);}
        }
        if(!out.length)throw new Error('No supported SUB media source is available for this episode');
        var result={streams:out};streamCache[url]={time:Date.now(),value:result};return result;
    }
    return {search:search,details:details,episodes:episodes,streams:streams};
}());
async function searchResults(keyword){try{return JSON.stringify(await MKissa.search(keyword));}catch(e){console.log('MKissa search: '+e.message);return JSON.stringify([]);}}
async function extractDetails(url){try{return JSON.stringify(await MKissa.details(url));}catch(e){console.log('MKissa details: '+e.message);return JSON.stringify({description:'Unable to load details: '+e.message,aliases:'',airdate:''});}}
async function extractEpisodes(url){try{return JSON.stringify(await MKissa.episodes(url));}catch(e){console.log('MKissa episodes: '+e.message);return JSON.stringify([]);}}
async function extractStreamUrl(url){try{return JSON.stringify(await MKissa.streams(url));}catch(e){console.log('MKissa streams: '+e.message);return JSON.stringify({streams:[],error:e.message});}}

// Portable SHA-256, HMAC-SHA-256 and AES-GCM. No native crypto bridge required.
var MKCrypto = (function () {
    function bytes(s) {
        var u = unescape(encodeURIComponent(s)), out = new Uint8Array(u.length);
        for (var i = 0; i < u.length; i++) out[i] = u.charCodeAt(i);
        return out;
    }
    function string(a) {
        var s = '';
        for (var i = 0; i < a.length; i++) s += '%' + ('0' + a[i].toString(16)).slice(-2);
        return decodeURIComponent(s);
    }
    function concat(a, b) { var o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }
    function hex(a) { var s = ''; for (var i = 0; i < a.length; i++) s += ('0' + a[i].toString(16)).slice(-2); return s; }
    var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    function b64(a) {
        var s = '';
        for (var i = 0; i < a.length; i += 3) {
            var n = (a[i] << 16) | ((a[i + 1] || 0) << 8) | (a[i + 2] || 0);
            s += alphabet[(n >>> 18) & 63] + alphabet[(n >>> 12) & 63] + (i + 1 < a.length ? alphabet[(n >>> 6) & 63] : '=') + (i + 2 < a.length ? alphabet[n & 63] : '=');
        }
        return s;
    }
    function unb64(s) {
        s = String(s).replace(/\s/g, '');
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4) throw new Error('Invalid base64');
        var a = [], n = 0, bits = 0;
        for (var i = 0; i < s.length && s[i] !== '='; i++) {
            n = (n << 6) | alphabet.indexOf(s[i]); bits += 6;
            if (bits >= 8) { bits -= 8; a.push((n >>> bits) & 255); }
        }
        return new Uint8Array(a);
    }
    var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    function rr(v, n) { return (v >>> n) | (v << (32 - n)); }
    function sha256(input) {
        var size = Math.ceil((input.length + 9) / 64) * 64, m = new Uint8Array(size);
        m.set(input); m[input.length] = 128;
        var bitLength = input.length * 8;
        for (var j = 0; j < 8; j++) { m[size - 1 - j] = bitLength % 256; bitLength = Math.floor(bitLength / 256); }
        var h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19], w = new Uint32Array(64);
        for (var offset = 0; offset < size; offset += 64) {
            for (j = 0; j < 16; j++) { var p = offset + j * 4; w[j] = (m[p] << 24) | (m[p + 1] << 16) | (m[p + 2] << 8) | m[p + 3]; }
            for (j = 16; j < 64; j++) {
                var x = w[j - 15], y = w[j - 2];
                w[j] = w[j - 16] + (rr(x,7) ^ rr(x,18) ^ (x >>> 3)) + w[j - 7] + (rr(y,17) ^ rr(y,19) ^ (y >>> 10));
            }
            var a=h[0], b=h[1], c=h[2], d=h[3], e=h[4], f=h[5], g=h[6], v=h[7];
            for (j = 0; j < 64; j++) {
                var t1 = (v + (rr(e,6)^rr(e,11)^rr(e,25)) + ((e&f)^(~e&g)) + K[j] + w[j]) | 0;
                var t2 = ((rr(a,2)^rr(a,13)^rr(a,22)) + ((a&b)^(a&c)^(b&c))) | 0;
                v=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
            }
            var state=[a,b,c,d,e,f,g,v]; for (j=0;j<8;j++) h[j]=(h[j]+state[j])|0;
        }
        var out = new Uint8Array(32);
        for (j=0;j<32;j++) out[j]=(h[j>>2] >>> (24-(j%4)*8))&255;
        return out;
    }
    function hmac(key, message) {
        if (key.length > 64) key = sha256(key);
        var inner = new Uint8Array(64), outer = new Uint8Array(64);
        for (var i=0;i<64;i++) { inner[i]=(key[i]||0)^54; outer[i]=(key[i]||0)^92; }
        return sha256(concat(outer,sha256(concat(inner,message))));
    }
    function mul(a,b) { var r=0; for(var i=0;i<8;i++){if(b&1)r^=a; a=((a<<1)^((a&128)?0x11b:0))&255;b>>>=1;}return r; }
    var sbox = new Uint8Array(256);
    for(var q=0;q<256;q++) {
        var inv=0;
        if(q) { inv=1; var base=q, power=254; while(power){if(power&1)inv=mul(inv,base);base=mul(base,base);power>>>=1;} }
        var z=inv; for(var k=1;k<=4;k++) z^=((inv<<k)|(inv>>>(8-k)))&255;
        sbox[q]=z^99;
    }
    function expand(key) {
        if(key.length!==32)throw new Error('Expected AES-256 key');
        var w=new Uint8Array(240);w.set(key);var rc=1;
        for(var i=32;i<240;i+=4){
            var t=[w[i-4],w[i-3],w[i-2],w[i-1]];
            if(i%32===0){var first=t.shift();t.push(first);for(var j=0;j<4;j++)t[j]=sbox[t[j]];t[0]^=rc;rc=mul(rc,2);}
            else if(i%32===16)for(j=0;j<4;j++)t[j]=sbox[t[j]];
            for(j=0;j<4;j++)w[i+j]=w[i+j-32]^t[j];
        }
        return w;
    }
    function block(w,input) {
        var s=new Uint8Array(16);for(var i=0;i<16;i++)s[i]=input[i]^w[i];
        for(var round=1;round<=14;round++){
            var t=new Uint8Array(16);
            for(var row=0;row<4;row++)for(var col=0;col<4;col++)t[col*4+row]=sbox[s[((col+row)%4)*4+row]];
            if(round<14)for(col=0;col<4;col++){
                var p=col*4,a=t[p],b=t[p+1],c=t[p+2],d=t[p+3];
                s[p]=mul(a,2)^mul(b,3)^c^d;s[p+1]=a^mul(b,2)^mul(c,3)^d;
                s[p+2]=a^b^mul(c,2)^mul(d,3);s[p+3]=mul(a,3)^b^c^mul(d,2);
            }else s=t;
            for(i=0;i<16;i++)s[i]^=w[round*16+i];
        }
        return s;
    }
    function field(x,h) {
        var z=new Uint8Array(16),v=new Uint8Array(h);
        for(var bit=0;bit<128;bit++){
            if(x[bit>>3]&(128>>>(bit%8)))for(var i=0;i<16;i++)z[i]^=v[i];
            var low=v[15]&1;
            for(i=15;i>=0;i--)v[i]=(v[i]>>>1)|(i?(v[i-1]&1)<<7:0);
            if(low)v[0]^=225;
        }
        return z;
    }
    function auth(w,iv,cipher) {
        var h=block(w,new Uint8Array(16)),y=new Uint8Array(16);
        for(var p=0;p<cipher.length;p+=16){
            for(var i=0;i<16;i++)y[i]^=cipher[p+i]||0;y=field(y,h);
        }
        var length=cipher.length*8,tail=new Uint8Array(16);
        for(i=15;i>=8;i--){tail[i]=length%256;length=Math.floor(length/256);}
        for(i=0;i<16;i++)y[i]^=tail[i];y=field(y,h);
        var j0=new Uint8Array(16);j0.set(iv);j0[15]=1;var encrypted=block(w,j0);
        for(i=0;i<16;i++)y[i]^=encrypted[i];return y;
    }
    function ctr(w,iv,input){
        var count=new Uint8Array(16);count.set(iv);count[15]=1;var out=new Uint8Array(input.length);
        for(var p=0;p<input.length;p+=16){
            for(var i=15;i>=12;i--){count[i]=(count[i]+1)&255;if(count[i])break;}
            var stream=block(w,count);for(i=0;i<16&&p+i<input.length;i++)out[p+i]=input[p+i]^stream[i];
        }
        return out;
    }
    function seal(key,iv,plain){
        if(iv.length!==12)throw new Error('Expected 96-bit GCM IV');var w=expand(key),c=ctr(w,iv,plain);return concat(c,auth(w,iv,c));
    }
    function open(key,iv,sealed){
        if(iv.length!==12||sealed.length<16)throw new Error('Invalid GCM envelope');
        var w=expand(key),c=sealed.slice(0,-16),tag=auth(w,iv,c),different=0;
        for(var i=0;i<16;i++)different|=tag[i]^sealed[sealed.length-16+i];
        if(different)throw new Error('GCM authentication failed');return ctr(w,iv,c);
    }
    return {bytes:bytes,string:string,concat:concat,hex:hex,b64:b64,unb64:unb64,sha256:sha256,hmac:hmac,seal:seal,open:open};
}());
