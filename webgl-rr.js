'use strict';

window.WebGLRR = (function(){
    var TAG_NAMESPACE = 'webglrr';
    var DISABLE_ATTACH_VAR = 'WEBGLRR_DISABLE_ATTACH';
    var DEFAULT_FRAMES_TO_RECORD = 2;
    var LOG_RECORDED_CALLS = false;
    var LOG_REPLAYED_CALLS = false;
    var MAX_CHAR_COUNT = (1 << 28) - 1;
    var REVIVABLE_KEY = '__as';
    var DEBUG_JSONSTRING_PARSING = false;
    var DEBUG_TYPEDARRAY_FROMJSON = false;

    var ASSERT_ON_MISSING_REMAP = true;

    var GUESS_ENUM_NAMES = true;
    var ENUM_NAME_PREFIX = '__GL_';


    function ASSERT(cond, text='<assertion failed>') {
        if (cond)
            return;

        var e = new Error(text);
        throw e;
    }

    function GetTag(obj, tagName) {
        ASSERT(obj instanceof Object);//, obj.toString());

        var tags = obj[TAG_NAMESPACE];
        if (tags === undefined)
            return undefined;

        var tag = tags[tagName];
        return tag;
    }

    function SetTag(obj, tagName, val) {
        ASSERT(GetTag(obj, tagName) === undefined);

        if (!(TAG_NAMESPACE in obj))
            obj[TAG_NAMESPACE] = {};

        obj[TAG_NAMESPACE][tagName] = val;
    }

    ////////////////////////////////////////////////////////////////////////////

    function PatchProtoFunc(proto, funcName) {
        var old = proto[funcName];
        if (old === undefined)
            throw new Error(proto.constructor.name + ' has no member ' + funcName);

        if ('isPatch' in old)
            return;

        var patch = function() {
            var args = arguments; // Magic indentifier!
            var ret = old.apply(this, args);

            RecordCall(this, funcName, args, ret);

            return ret;
        };

        patch.isPatch = null;
        proto[funcName] = patch;
    }

    var kEnumMapByName = {};
    var kEnumMapByValue = {};

    function GatherEnumsFromProtos(proto) {
        Object.getOwnPropertyNames(proto).forEach( name => {
            if (name === 'constructor')
                return;

            if (proto.__lookupGetter__(name) !== undefined)
                return; // drawingBufferWidth, et al

            if (typeof(proto[name]) === 'function')
                return;

            if (name.toUpperCase() === name) {
                kEnumMapByName[name] = proto[name];
                kEnumMapByValue[proto[name]] = name;
                return;
            }
        });
    }
    GatherEnumsFromProtos(WebGLRenderingContext.prototype);
    if (window.WebGL2RenderingContext !== undefined) {
        GatherEnumsFromProtos(WebGL2RenderingContext.prototype);
    }

    function PatchWebGLProtos(proto) {
        Object.getOwnPropertyNames(proto).forEach( name => {
            if (name === 'constructor')
                return;

            if (proto.__lookupGetter__(name) !== undefined)
                return; // drawingBufferWidth, et al

            //console.log(name);
            if (typeof(proto[name]) === 'function') {
                PatchProtoFunc(proto, name);
                return;
            }
        });
    }

    function PatchForRecording() {
        PatchProtoFunc(HTMLCanvasElement.prototype, 'getContext');

        PatchWebGLProtos(WebGLRenderingContext.prototype);

        if (window.WebGL2RenderingContext !== undefined) {
            PatchWebGLProtos(WebGL2RenderingContext.prototype);
        }
    }

    ////////////////////////////////////////////////////////////////////////////

    function ArgToString(arg) {
        if (arg instanceof Array)
            return '[' + arg.join(', ') + ']';

        if (typeof(arg) === 'string')
            return '"' + arg + '"';

        return '' + arg;
    }

    ////////////////////////////////////

    function CCall(objId, funcName, args, ret) {
        this.objId = objId;
        this.funcName = funcName;
        this.args = args;
        this.ret = ret;
    }

    CCall.prototype.toString = function() {
        var objStr = this.objId.toString();
        var argStrs = this.args.map(ArgToString);
        var retStr = '';
        if (this.ret !== undefined) {
            retStr = '->(' + ArgToString(this.ret) + ')';
        }

        var res = objStr + '.' + this.funcName + '(' + argStrs.join(', ') + ')' + retStr;
        return res;
    };

    CCall.prototype.toJSON = function() {
        var remapStr = this.objId.toString();

        var args = this.args;
        if (GUESS_ENUM_NAMES) {
            args = args.map(arg => {
                if (typeof(arg) !== 'number')
                    return arg;

                var isInt = (Math.round(arg) === arg);
                if (isInt && arg >= 0x0800) {
                    if (kEnumMapByValue[arg] !== undefined) {
                        arg = ENUM_NAME_PREFIX + kEnumMapByValue[arg];
                        return arg;
                    }
                }
                return arg;
            });
        }

        var ret = [remapStr, this.funcName, args, this.ret];
        if (this.ret === undefined) {
            ret.pop();
        }
        return ret;
    };

    CCall.fromShorthandJSON = function(json) {
        var remapStr = json[0];
        var objId = CRemapId.fromString(remapStr);

        var args = json[2];
        if (GUESS_ENUM_NAMES) {
            args = args.map(arg => {
                if (typeof(arg) !== 'string')
                    return arg;

                if (!arg.startsWith(ENUM_NAME_PREFIX))
                    return arg;

                var name = arg.slice(ENUM_NAME_PREFIX.length);
                if (kEnumMapByName[name] === undefined) {
                    console.log(name);
                    throw Error('Failed to parse: ' + arg);
                }

                return kEnumMapByName[name];
            });
        }

        return new CCall(objId, json[1], args, json[3]);
    };

    /*
    CCall.prototype.toJSON = function() {
        var ret = {};
        ret[REVIVABLE_KEY] = ['CCall',  this.objId, this.funcName, this.args, this.ret];
        return ret;
    };
    CCall.fromJSON = function(json) {
        var data = json[REVIVABLE_KEY];
        return new CCall(data[1], data[2], data[3], data[4]);
    };
    */

    ////////////////////////////////////

    function CRemapId(objTypeStr, id) {
        this.objTypeStr = objTypeStr;
        this.id = id;
    }

    CRemapId.prototype.toString = function() {
        return this.objTypeStr + '$' + this.id;
    };

    CRemapId.prototype.toJSON = function() {
        var ret = {};
        ret[REVIVABLE_KEY] = ['CRemapId', this.objTypeStr, this.id];
        return ret;
    };

    CRemapId.fromJSON = function(json) {
        var data = json[REVIVABLE_KEY];
        return new CRemapId(data[1], data[2]);
    };

    CRemapId.fromString = function(str) {
        var split = str.split('$');
        ASSERT(split.length == 2);

        var typeStr = split[0];
        var id = parseInt(split[1]);
        return new CRemapId(typeStr, id);
    }

    ////////////////////////////////////////////////////////////////////////////

    function CMediaSnapshot(dataURL) {
        this.dataURL = dataURL;
    }

    CMediaSnapshot.From = function(elem) {
        var c = document.createElement('canvas');
        c.width = elem.naturalWidth || elem.width;
        c.height = elem.naturalHeight || elem.height;
        var c2d = c.getContext('2d');
        c2d.drawImage(elem, 0, 0);

        var dataURL = c.toDataURL();
        return new CMediaSnapshot(dataURL);
    };

    ////////////////////////////////////////////////////////////////////////////

    var kSerializableCtors = [
        CCall,
        CRemapId,
    ];

    var kTypedArrayCtors = [
        ArrayBuffer,
        Float32Array,
        Int8Array,
        Int16Array,
        Int32Array,
        Uint8Array,
        Uint16Array,
        Uint32Array,
    ];

    var kWebGLObjectCtors = [
        WebGLRenderingContext,
        WebGLBuffer,
        WebGLFramebuffer,
        WebGLProgram,
        WebGLRenderbuffer,
        WebGLShader,
        WebGLTexture,
        WebGLUniformLocation,
    ];

    if (window.WebGL2RenderingContext) {
        kWebGLObjectCtors = kWebGLObjectCtors.concat([
            WebGL2RenderingContext,
            WebGLSampler,
            WebGLSync,
            WebGLTransformFeedback,
            WebGLQuery,
            WebGLVertexArrayObject,
        ]);
    }

    var kMediaElemCtors = [
        HTMLCanvasElement,
        HTMLImageElement,
        HTMLVideoElement,
    ];

    ////////////////////////////////////////////////////////////////////////////

    var hexForByte = [];
    for (var i = 0; i < 256; i++) {
        var hex = i.toString(16);
        if (hex.length != 2) {
            hex = '0' + hex;
        }
        ASSERT(hex.length == 2);
        hexForByte[i] = hex;
    }

    function ByteToHex(b) {
        return hexForByte[b];
    }

    function ToJSON_TypedArray() {
        var ctor = this.constructor;

        var byteArr;
        if (ctor === ArrayBuffer) {
            byteArr = new Uint8Array(this);
        } else {
            byteArr = new Uint8Array(this.buffer, this.byteOffset, this.byteLength);
        }

        var DUMP_THRESHOLD = 1*1024*1024;
        var shouldDump = (this.byteLength >= DUMP_THRESHOLD);
        if (shouldDump) {
            var kib = this.byteLength / 1024;
            kib |= 0;
            console.log('ToJSON_TypedArray: ' + kib + 'KiB.');
        }

        var timer = new CTimer();

        //var byteStrList = Array.map(byteArr, ByteToHex); (slower)
        var byteStrList = Array(byteArr.length);
        for (var i = 0; i < byteArr.length; i++) {
            byteStrList[i] = ByteToHex(byteArr[i]);
        }

        if (shouldDump) {
            console.log('  byteStrList in ' + timer.Split());
        }

        var dataStr = byteStrList.join('');

        /* (faster if you skip the final slice, but slows down later serialization, likely due to string roping)
        var dataStr = '';
        for (var i = 0; i < byteArr.length; i++) {
            dataStr += ByteToHex(byteArr[i]);
        }
        dataStr = dataStr.slice();
        */
        if (shouldDump) {
            console.log('  dataStr in ' + timer.Split());
            console.log('  total in ' + timer.Total());
        }

        //var byteCount = dataStr.length / 2;
        //ASSERT(dataStr.length % 2 == 0);

        var ret = {};
        ret[REVIVABLE_KEY] = [ctor.name, dataStr];
        return ret;
    }

    var kHexToNibble = {};
    for (var i = 0; i < 16; i++) {
        var hex = i.toString(16).charCodeAt(0);
        kHexToNibble[hex] = i;
    };

    function FromJSON_TypedArray(json) {
        var reviveData = json[REVIVABLE_KEY];
        var ctorName = reviveData[0];
        var dataStr = reviveData[1];

        var byteCount = dataStr.length / 2;
        ASSERT(dataStr.length % 2 == 0, byteCount);

        var timer = new CTimer();

        var DUMP_THRESHOLD = 1*1024*1024;
        var shouldDump = DEBUG_TYPEDARRAY_FROMJSON && (byteCount >= DUMP_THRESHOLD)
        if (shouldDump) {
            var kib = byteCount / 1024;
            kib |= 0;
            console.log('Converting ' + kib + 'KiB to ' + ctorName + '.');
        }

        var byteArr = new Uint8Array(byteCount);

        if (shouldDump) {
            var split = Decimals(timer.Split(), 1);
            console.log('  allocated in ' + split + 'ms.');
        }

        for (var i = 0; i < byteCount; i++) {
            var hexCharCode0 = dataStr.charCodeAt(2*i);
            var hexCharCode1 = dataStr.charCodeAt(2*i + 1);
            var val = (kHexToNibble[hexCharCode0] << 4) | kHexToNibble[hexCharCode1];
            byteArr[i] = val;
        }

        if (shouldDump) {
            var split = timer.Split();
            console.log('  converted in ' + Decimals(split, 1) + 'ms.');
            var mibPerSec = (byteCount / 1024 / 1024) / (split / 1000);
            console.log('  ~' + mibPerSec + 'MiB/s.');
        }

        var obj = byteArr.buffer;
        if (ctorName != 'ArrayBuffer') {
            var ctor = window[ctorName];
            obj = new ctor(obj);
        }

        return obj;
    }

    ////////////////////////////////////////////////////////////////////////////

    var framesStillToRecord = 0;
    var curFrameArr;// = [];
    var recordedFrames;// = [];
    var isWaitingForFrameEnd;// = false;
    var mediaSnapshots;// = {};

    var nextRemapId;// = 0;

    function CGLState_Global() {
        this.unpackRowLength = 0;
        this.unpackSkipRows = 0;
        this.unpackSkipPixels = 0;
        this.unpackAlignment = 4;
        this.unpackImageHeight = 0;
        this.unpackSkipImages = 0;
    }

    function Record(framesToRecord=Infinity) {
        framesStillToRecord = framesToRecord;
        curFrameArr = [];
        recordedFrames = [];
        isWaitingForFrameEnd = false;
        mediaSnapshots = {};

        nextRemapId = 0;
    }

    ////////////////////////////////////////////////////////////////////////////

    function TagForRemap(obj) {
        var tag = GetTag(obj, 'remapId');
        if (tag !== undefined)
            return tag;

        var objTypeStr = obj.constructor.name;
        var remapId = new CRemapId(objTypeStr, nextRemapId);
        nextRemapId += 1;

        //console.log('new ' + remapId + ' from ' + curFuncName);

        SetTag(obj, 'remapId', remapId);
        return remapId;
    }

    function Pickle(anyVal) {
        if (!(anyVal instanceof Object))
            return anyVal;

        if (anyVal instanceof Array) {
            var ret = anyVal.map(function(x, i) {
                //console.log(i);
                return Pickle(x);
            });
            return ret;
        }

        var ctor = anyVal.constructor;

        if (kWebGLObjectCtors.indexOf(ctor) != -1)
            return TagForRemap(anyVal);

        if (kTypedArrayCtors.indexOf(ctor) != -1) {
            var byteLen = anyVal.byteLength;
            var miByteLen = byteLen / (1024*1024);
            if (miByteLen >= 3.0) {
                miByteLen |= 0;
                //console.log('(' + curFuncName + ') slicing a ' + ctor.name + '(' + miByteLen + 'MiB)');
                //dumpCurCall = true;
            }
            var ret = anyVal.slice();
            ret.toJSON = ToJSON_TypedArray;
            return ret;
        }

        if (kMediaElemCtors.indexOf(ctor) != -1) {
            var ret = TagForRemap(anyVal);

            var media = CMediaSnapshot.From(anyVal);
            mediaSnapshots[ret.id] = media;

            return ret;
        }

        if (ctor === WebGLActiveInfo) {
            return {
                size: anyVal.size,
                type: anyVal.type,
                name: anyVal.name,
            };
        }

        if (ctor === Object) {
            var ret = {};
            for (var k in anyVal) {
                ret[k] = anyVal[k];
            }
            return ret;
        }

        throw new Error('Unhandled Object type: ' + ctor.name);
    }

    var curFuncName = '';
    var dumpCurCall = false;

    var GL_UNSIGNED_SHORT_4_4_4_4 = 0x8033;
    var GL_UNSIGNED_SHORT_5_5_5_1 = 0x8034;
    var GL_UNSIGNED_SHORT_5_6_5 = 0x8363;
    var GL_UNSIGNED_INT_10F_11F_11F_REV = 0x8C3B;
    var GL_UNSIGNED_INT_2_10_10_10_REV = 0x8368;
    var GL_UNSIGNED_INT_24_8 = 0x84FA;
    var GL_UNSIGNED_INT_5_9_9_9_REV = 0x8C3E;
    var GL_FLOAT_32_UNSIGNED_INT_24_8_REV = 0x8DAD;
    var GL_BYTE = 0x1400;
    var GL_UNSIGNED_BYTE = 0x1401;
    var GL_SHORT = 0x1402;
    var GL_UNSIGNED_SHORT = 0x1403;
    var GL_HALF_FLOAT = 0x140B;
    var GL_HALF_FLOAT_OES = 0x8D61;
    var GL_INT = 0x1403;
    var GL_UNSIGNED_INT = 0x140B;
    var GL_FLOAT = 0x8D61;

    var GL_RG = 0x8227;
    var GL_RG_INTEGER = 0x8228;
    var GL_LUMINANCE_ALPHA = 0x190A;
    var GL_RGB = 0x1907;
    var GL_RGB_INTEGER = 0x8D98;
    var GL_RGBA = 0x1908;
    var GL_RGBA_INTEGER = 0x8D99;

    function BytesPerPixel(format, type) {
        var bytesPerChannel;
        switch (type) {
        case GL_UNSIGNED_SHORT_4_4_4_4:
        case GL_UNSIGNED_SHORT_5_5_5_1:
        case GL_UNSIGNED_SHORT_5_6_5:
            return 2;

        case GL_UNSIGNED_INT_10F_11F_11F_REV:
        case GL_UNSIGNED_INT_2_10_10_10_REV:
        case GL_UNSIGNED_INT_24_8:
        case GL_UNSIGNED_INT_5_9_9_9_REV:
            return 4;

        case GL_FLOAT_32_UNSIGNED_INT_24_8_REV:
            return 8;

        // Alright, that's all the fixed-size unpackTypes.

        case GL_BYTE:
        case GL_UNSIGNED_BYTE:
            bytesPerChannel = 1;
            break;

        case GL_SHORT:
        case GL_UNSIGNED_SHORT:
        case GL_HALF_FLOAT:
        case GL_HALF_FLOAT_OES:
            bytesPerChannel = 2;
            break;

        case GL_INT:
        case GL_UNSIGNED_INT:
        case GL_FLOAT:
            bytesPerChannel = 4;
            break;

        default:
            throw new Error('Unrecognized type: 0x' + type.toString(16));
        }

        var channels;
        switch (format) {
        case GL_RG:
        case GL_RG_INTEGER:
        case GL_LUMINANCE_ALPHA:
            channels = 2;
            break;

        case GL_RGB:
        case GL_RGB_INTEGER:
            channels = 3;
            break;

        case GL_RGBA:
        case GL_RGBA_INTEGER:
            channels = 4;
            break;

        default:
            channels = 1;
            break;
        }

        return bytesPerChannel * channels;
    }

    function BytesNeeded(state, width, height, depth, format, type) {
        var bpp = BytesPerPixel(format, type);

        var rowLength = width; // in 'groups' (pixels)
        if (state.unpackRowLength) {
            rowLength = state.unpackRowLength;
        }

        var imageHeight = height;
        if (state.unpackImageHeight) {
            imageHeight = state.unpackImageHeight;
        }

        var rowStride = bpp * rowLength;
        while (rowStride % state.unpackAlignment != 0) {
            rowStride += 1;
        }

        var imageStride = rowStride * imageHeight;

        var offset = bpp * state.unpackSkipPixels;
        offset += rowStride * state.unpackSkipRows;
        offset += imageStride * state.unpackSkipImages;

        var end = offset;
        end += imageStride * depth;
        end += rowStride * height;
        end += bpp * width;

        return end;
    }

    function RecordCall(thisObj, funcName, args, ret) {
        if (!framesStillToRecord)
            return;

        if (funcName == 'getContext' && args[0] == '2d')
            return;

        curFuncName = funcName;

        var thisRemapId = TagForRemap(thisObj);
        //console.log(thisRemapId.toString() + '.' + funcName);

        var argArray = Array.prototype.slice.call(args); // Otherwise is of type Arguments.

        ////////////

        if (funcName == 'texSubImage3D' && argArray.length == 11) {
            var width = argArray[5];
            var height = argArray[6];
            var depth = argArray[7];
            var format = argArray[8];
            var type = argArray[9];
            var pixels = argArray[10];

            var state = GetTag(thisObj, 'state');
            //console.log(JSON.stringify(state));

            var bytesNeeded = BytesNeeded(state, width, height, depth, format, type);
            //console.log('bytesNeeded: ' + bytesNeeded);

            var bytesPerElem = 1;
            if (!(pixels instanceof ArrayBuffer))
                bytesPerElem = pixels.BYTES_PER_ELEMENT;

            var elemsNeeded = Math.ceil(bytesNeeded / bytesPerElem);
            argArray[10] = pixels.subarray(0, elemsNeeded);
        }

        ////////////

        var pickledArgs = Pickle(argArray);

        var pickledRet = Pickle(ret);

        var call = new CCall(thisRemapId, funcName, pickledArgs, pickledRet);
        curFrameArr.push(call);

        if (LOG_RECORDED_CALLS || dumpCurCall) {
            dumpCurCall = false;
            console.log(call.toString());
        }

        ////////////

        if (!isWaitingForFrameEnd) {
            isWaitingForFrameEnd = true;

            requestAnimationFrame(function(){
                isWaitingForFrameEnd = false;

                if (LOG_RECORDED_CALLS) {
                    console.log('requestAnimationFrame received after frame ' + recordedFrames.length + '.');
                }

                recordedFrames.push(curFrameArr);
                curFrameArr = [];
                framesStillToRecord -= 1;

                if (!framesStillToRecord) {
                    console.log(recordedFrames.length + ' frame(s) recorded.');
                    var totalCalls = 0;
                    recordedFrames.forEach(function(x) {
                      totalCalls += x.length;
                    });
                    console.log('(' + totalCalls + ' calls)');
                }
            });
        }

        ////////////

        if (funcName == 'getContext' && ret) {
            if (GetTag(ret, 'state') === undefined) {
                SetTag(ret, 'state', new CGLState_Global());
            }
        }

        if (funcName == 'pixelStorei') {
            var state = GetTag(thisObj, 'state');
            switch (args[0]) {
            case 0x0CF2: // UNPACK_ROW_LENGTH
                state.unpackRowLength = args[1];
                break;
            case 0x0CF3: // UNPACK_SKIP_ROWS
                state.unpackSkipRows = args[1];
                break;
            case 0x0CF4: // UNPACK_SKIP_PIXELS
                state.unpackSkipPixels = args[1];
                break;
            case 0x0CF5: // UNPACK_ALIGNMENT
                state.unpackAlignment = args[1];
                break;
            case 0x806E: // UNPACK_IMAGE_HEIGHT
                state.unpackImageHeight = args[1];
                break;
            case 0x806D: // UNPACK_SKIP_IMAGES
                state.unpackSkipImages = args[1];
                break;
            }
        }
    }

    ////////////////////////////////////////////////////////////////////////////

    function CJSONSerializer(reviveFuncMap) {
        function JSONRevive(k, v) {
            if (!(v instanceof Object))
                return v;

            var data = v[REVIVABLE_KEY];
            if (data === undefined)
                return v;

            var ctorName = data[0];
            var func = reviveFuncMap[ctorName];
            if (func === undefined)
                throw new Error('Non-revivable ctor: ' + ctorName);

            return func(v);
        }

        function Serialize(root) {
            return JSON.stringify(root);
        }

        function Deserialize(textArr) {
            return ParseJSONFromArr(textArr, JSONRevive);
        }

        return {
            Serialize: Serialize,
            Deserialize: Deserialize,
        };
    }

    ////////////////////////////////////////////////////////////////////////////

    var kRevivableCtors = [
        CRemapId,
        //CCall,
    ];

    var kReviveFuncMap = {};

    kRevivableCtors.forEach(function(ctor) {
        ASSERT('fromJSON' in ctor);
        kReviveFuncMap[ctor.name] = ctor.fromJSON;
    });

    kTypedArrayCtors.forEach(function(ctor) {
        kReviveFuncMap[ctor.name] = FromJSON_TypedArray;
    });

    var kSerializer = new CJSONSerializer(kReviveFuncMap);

    ////////////////////////////////////////////////////////////////////////////

    function DownloadText(filename, textArr, mimetype='text/plain') {
        var blob = new Blob(textArr, {type: mimetype});
        var url = URL.createObjectURL(blob);

        var link = document.createElement('a');
        link.href = url;
        link.download = filename;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    ////////////////////////////////////////////////////////////////////////////

    // Alright, let's export.

    function Decimals(val, digits) {
        var scale = Math.pow(10, digits);
        val = ((val * scale) | 0 ) / scale;
        return val;
    }

    function CTimer() {
        this.start = performance.now();
        this.split = this.start;

        this.Total = function() {
            var diff = performance.now() - this.start;
            return diff;
        };
        this.Split = function() {
            var now = performance.now();
            var diff = now - this.split;
            this.split = now;

            return diff;
        };
    }

    function EscapeUnicode(wstr) {
        var parts = [];
        var partStart = 0;
        //Array.forEach(wstr, function(x, i){
        for (var i = 0; i < wstr.length; i++) {
            //var charCode = x.charCodeAt(0);
            var charCode = wstr.charCodeAt(i);
            if (charCode < 128)
                continue;

            var newPart = wstr.substring(partStart, i);
            if (newPart.length) {
                parts.push(newPart);
            }

            var charCodeStr = charCode.toString(16);
            while (charCodeStr.length < 4) {
                charCodeStr = '0' + charCodeStr;
            }
            var uform = '\\u' + charCodeStr;

            parts.push(uform);
            partStart = i + 1;
        //});
        }

        if (!parts.length)
            return wstr;

        var newPart = wstr.substring(partStart);
        if (newPart.length) {
            parts.push(newPart);
        }
        var ret = parts.join('');
        return ret;
    }

    function Export() {
        var docCanvasCollection = document.getElementsByTagName('canvas');

        console.log('Export()');
        var timer = new CTimer();

        function ToJSON(x) {
           return kSerializer.Serialize(x, 0);
        }

        var parts = [];
        parts.push(
            '{',
            '\n  "canvases": ['
        );

        var canvasRecords = [];
        var isInitial = true;
        Array.forEach(docCanvasCollection, function(c, i) {
            var remapId = GetTag(c, 'remapId');
            if (remapId === undefined)
              return;

            var data = {
                remapId: remapId,
                width: c.width,
                height: c.height,
            };
            var json = ToJSON(data);

            if (isInitial) {
                isInitial = false;
            } else {
                parts.push(',');
            }
            parts.push('\n    ', ToJSON(data));
        });

        console.log('canvases: ' + Decimals(timer.Split(), 0) + 'ms.');

        parts.push(
            '\n  ],',
            '\n  "snapshots": {'
        );

        var snapshotParts = [];
        var initial = true;
        for (var k in mediaSnapshots) {
            if (initial) {
                initial = false;
            } else {
                parts.push(',');
            }

            var snapshot = mediaSnapshots[k];
            parts.push('\n    "' + k.toString(), '": "', snapshot.dataURL, '"');
        }

        console.log('snapshots: ' + Decimals(timer.Split(), 0) + 'ms.');

        parts.push(
            '\n  },',
            '\n  "frames": ['
        );

        recordedFrames.forEach(function(callList, i) {
            if (i != 0) {
                parts.push(',');
            }
            parts.push('\n    [');

            callList.forEach(function(call, j){
                if (j != 0) {
                    parts.push(',');
                }

                var json = ToJSON(call);
                parts.push('\n      ', json);
            });

            parts.push('\n    ]');
        });

        console.log('frames: ' + Decimals(timer.Split(), 0) + 'ms.');

        parts.push(
            '\n  ]',
            '\n}'
        );

        parts = parts.map(EscapeUnicode);
        console.log('escaping unicode: ' + Decimals(timer.Split(), 0) + 'ms.');

        var totalLen = 0;
        parts.forEach(function(x, i) {
            totalLen += x.length;
        });

        var totalLenKiB = (totalLen / 1024) | 0;
        console.log('totalLen: ' + totalLenKiB + 'KiB');

        console.log('total: ' + Decimals(timer.Total(), 0) + 'ms.');

        if (totalLen > MAX_CHAR_COUNT) {
            console.log('Warning: Length exceeds max char count: ' + totalLen);
        }

        return parts;
    }

    function Download() {
        var textArr = Export();
        DownloadText('recording.json', textArr, 'text/json');
    }

    function Dump() {
        var textArr = Export();

        var totalLen = 0;
        textArr.forEach(function(x, i) {
            totalLen += x.length;
        });

        if (totalLen > MAX_CHAR_COUNT)
            throw new Error('Length exceeds max char count: ' + totalLen);

        var json = textArr.join('');

        console.log(json);
    }

    ////////////////////////////////////////////////////////////////////////////

    function ParseJSONFromArr(textArr, fnRevive) {
        if (!fnRevive) {
            fnRevive = function(k, v) { return v; };
        }

        ////////////

        function IsIn(ref, arr) {
            var isNotIn = arr.every(function(x) { return x !== ref; });
            return !isNotIn;
        }

        function CArrayReader(textArr) {
            textArr.forEach(function(x,i) {
                ASSERT(x.length > 0, '[' + i + '].length > 0');
            });

            this.EOF = {};

            var pageId = 0;
            var pagePos = 0;
            var lineNum = 1;
            var linePos = 0;

            var curPage = textArr[0];

            function CPos() {
                this.pageId = pageId;
                this.pagePos = pagePos;
                this.lineNum = lineNum;
                this.linePos = linePos;

                this.toString = function() {
                    var val;
                    if (curPage === undefined) {
                        val = '<EOF>';
                    } else {
                        val = curPage[this.pagePos];
                    }
                    return '"' + val + '"@[' + this.lineNum + ', ' + this.linePos + ']';
                };
            };

            this.Pos = function() {
                return new CPos();
            };

            this.Peek = function() {
                if (curPage === undefined)
                    throw this.EOF;

                var ret = curPage.charCodeAt(pagePos);
                return ret;
            };

            this.Next = function() {
                if (curPage === undefined)
                    throw this.EOF;

                var ret = curPage.charCodeAt(pagePos);
                pagePos += 1;

                if (pagePos >= curPage.length) {
                    pageId += 1;
                    curPage = textArr[pageId];
                    pagePos = 0;
                }

                linePos += 1;
                if (ret === 0x0a) { // \n
                    lineNum += 1;
                    if (lineNum % 3000 == 0) {
                        console.log('lineNum', lineNum);
                    }
                    linePos = 0;
                }

                return ret;
            };

            this.Slice = function(start, end) {
                //console.log(start, end);

                if (start.pageId == end.pageId) {
                    var page = textArr[start.pageId];
                    return page.slice(start.pagePos, end.pagePos);
                }

                var slicePages = textArr.slice(start.pageId, end.pageId + 1);
                if (!slicePages.length)
                    return '';

                var lastSlicePage = slicePages.length - 1;
                //console.log(end.pageId, end.pagePos, lastSlicePage, slicePages[lastSlicePage].length);
                slicePages[lastSlicePage] = slicePages[lastSlicePage].slice(0, end.pagePos);

                slicePages[0] = slicePages[0].slice(start.pagePos);

                return slicePages.join('');
            };

            this.Ignore = function(chars) {
                while (true) {
                    var cur = this.Peek();
                    if (!IsIn(cur, chars))
                        return cur;

                    this.Next();
                }
            };

            this.Seek = function(chars) {
                while (true) {
                    var cur = this.Peek();
                    if (IsIn(cur, chars))
                        return cur;

                    this.Next();
                }
            };
        }

        ////////////

        var reader = new CArrayReader(textArr);

        ////////////

        var kJSON_WhitespaceList = [0x20, 0x9, 0xd, 0xa];

        function ParseError(text) {
            return new Error('Parse error: ' + text);
        }

        function SeekNonWhitespace() {
            return reader.Ignore(kJSON_WhitespaceList);
        }

        function SeekNonWhitespaceAndExpect(expected) {
            var peek = SeekNonWhitespace();
            if (peek === expected)
                return;

            var expectedChar = String.fromCodePoint(expected);
            var pos = reader.Pos();
            throw ParseError('Expected "' + expectedChar + '": ' + pos);
        }

        ////////////

        function Parse_JSONString() {
            var startPos = reader.Pos();
            var start = reader.Next();
            ASSERT(start === 0x22); // "

            var timer = new CTimer();
            var chars = 0;

            while (true) {
                var cur = reader.Next();
                chars += 1;

                if (cur === 0x5c) { // '\\'
                    reader.Next();
                    chars += 1;
                    continue;
                }

                if (cur === 0x22) // "
                    break;
            }

            // BTW, cow is '\uD83D\uDC04'.

            var DUMP_THRESHOLD = 1*1024*1024;
            var shouldDump = DEBUG_JSONSTRING_PARSING && (chars >= DUMP_THRESHOLD);
            if (shouldDump) {
                var kib = (chars / 1024) | 0;
                var split = timer.Split();
                var mibPerSec = (chars / (1024*1024)) / (split / 1000);
                split = ((split * 10) | 0) / 10;
                console.log('Parsed ' + kib + 'KiB in ' + split + 'ms.');

                mibPerSec = ((mibPerSec * 10) | 0) / 10;
                console.log('  ~' + mibPerSec + 'MiB/s.');
            }

            var endPos = reader.Pos();
            var jsonStr = reader.Slice(startPos, endPos);

            if (shouldDump) {
                var split = timer.Split();
                split = ((split * 10) | 0) / 10;
                //console.log('  split in ' + split + 'ms.');
            }

            var ret = JSON.parse(jsonStr);

            if (shouldDump) {
                var split = timer.Split();
                split = ((split * 10) | 0) / 10;
                console.log('  reparsed in ' + split + 'ms.');
            }

            return ret;
        }

        ////////////

        function Parse_JSON(fnRevive, terminals) {
            var peek = SeekNonWhitespace();
            var startPos = reader.Pos();

            try {
                if (peek === 0x22) // "
                    return Parse_JSONString();

                if (peek === 0x5b) { // [
                    var ret = [];

                    while (true) {
                        ASSERT(IsIn(reader.Next(), [0x5b, 0x2c])); // [ and ,

                        var peekNonWhitespace = SeekNonWhitespace();
                        if (peekNonWhitespace == 0x5d) // ]
                            break;

                        var val = Parse_JSON(fnRevive, [0x2c, 0x5d]); // , and ]
                        if (val !== undefined) {
                            var key = ret.length;

                            val = fnRevive(key, val);
                            ret.push(val);

                            var peekTerm = SeekNonWhitespace();
                            if (peekTerm === 0x2c) // ,
                                continue;

                            if (peekTerm === 0x5d) // ]
                                break;
                        }
                        var endPos = reader.Pos();
                        throw ParseError('Unmatched ' + startPos + ': ' + endPos);
                    }

                    ASSERT(reader.Next() == 0x5d); // ]
                    return ret;
                }

                if (peek == 0x7b) { // {
                    var ret = {};

                    while (true) {
                        ASSERT(IsIn(reader.Next(), [0x7b, 0x2c])); // { and ,

                        var peekKeyStart = SeekNonWhitespace();
                        if (peekKeyStart === 0x7d) // }
                            break;

                        if (peekKeyStart !== 0x22) // "
                            throw ParseError('Expected """: ' + reader.Pos());

                        var key = Parse_JSONString();

                        SeekNonWhitespaceAndExpect(0x3a); // :
                        ASSERT(reader.Next() === 0x3a); // :

                        var val = Parse_JSON(fnRevive, [0x2c, 0x7d]); // , and }
                        if (val !== undefined) {
                            val = fnRevive(key, val);
                            ret[key] = val;

                            var peekTerm = SeekNonWhitespace();
                            if (peekTerm === 0x2c) // ,
                                continue;

                            if (peekTerm === 0x7d) // }
                                break;
                        }

                        var endPos = reader.Pos();
                        throw ParseError('Unmatched ' + startPos + ': ' + endPos);
                    }

                    ASSERT(reader.Next() === 0x7d); // }
                    //console.log(Object.keys(ret));
                    return ret;
                }

                ////////

                try {
                    reader.Seek(terminals);
                } catch (e) {
                    if (e !== reader.EOF)
                        throw e;

                    if (terminals.length)
                        throw ParseError('Unexpected EOF parsing prim from ' + startPos + '.');
                    // If `terminals` is empty, this is what we wanted.
                }

                var endPos = reader.Pos();
                var primStr = reader.Slice(startPos, endPos);
                try {
                    var prim = JSON.parse(primStr);
                } catch (e) {
                    console.log('JSON.parse failed to parse "' + primStr + '" starting at: ' + startPos);
                    throw e;
                }
                return prim;

            } catch (e) {
                if (e !== reader.EOF)
                    throw e;

                throw ParseError('Unexpected EOF.');
            }
        }

        ////////////

        var ret = Parse_JSON(fnRevive, []);
        try {
            SeekNonWhitespace();
        } catch (e) {
            if (e !== reader.EOF)
                throw e;
        }
        return ret;
    }

    function Import(textArr) {
        ASSERT(textArr instanceof Array);
        var root = kSerializer.Deserialize(textArr);

        var frames = root.frames;
        frames.forEach(function(calls) {
            calls.forEach(function(call, i) {
                calls[i] = CCall.fromShorthandJSON(call);
            });
        });

        return root;
    }

    ////////////////////////////////////////////////////////////////////////////

    function LoadReplay(textArr) {
        return new CReplayBase(textArr);
    }

    function CReplayBase(textArr) {
        var start = performance.now();

        var recording = Import(textArr);

        var diffMS = performance.now() - start;
        diffMS |= 0;
        console.log('Loaded ' + recording.frames.length + ' frame(s) in ' + diffMS + 'ms.');

        var baseObjects = {};

        var snapshots = recording.snapshots;
        for (var k in snapshots) {
            var dataURL = snapshots[k];

            var img = document.createElement('img');
            img.src = dataURL;

            baseObjects[k] = img;
        }

        function FrameCount() {
            return recording.frames.length;
        }

        function NewReplay() {
            return new CReplay(recording, baseObjects);
        }

        return {
            FrameCount: FrameCount,
            NewReplay: NewReplay,
        };
    }

    function CReplay(recording, baseObjects) {
        var activeObjects = {};
        var curFrameId = 0;
        var curCallId = 0;

        for (var k in baseObjects) {
            activeObjects[k] = baseObjects[k];
        }

        var canvasList = [];

        recording.canvases.forEach(function(data) {
            var c = document.createElement('canvas');
            c.width = data.width;
            c.height = data.height;

            canvasList.push(c);
            SetRemapped(data.remapId, c);
        });

        function Canvases() {
            return canvasList;
        }

        function SetRemapped(remapId, obj) {
            activeObjects[remapId.id] = obj;
            obj.remapId = remapId;
        }

        function GetRemapped(remapId) {
            var obj = activeObjects[remapId.id];
            if (ASSERT_ON_MISSING_REMAP) {
                ASSERT(obj !== undefined);//, 'Undefined active object: ' + remapId);
            }
            return obj;
        }

        function NextFrame() {
            // Are we already out of frames?
            if (!(curFrameId in recording.frames))
                return false;

            var startFrameId = curFrameId;
            var endFrameId = startFrameId + 1;
            var hasMore = true;
            var totalCalls = 0;

            var start = performance.now();
            while (curFrameId < endFrameId) {
                totalCalls += 1;
                if (!NextCall()) {
                    hasMore = false;
                    break;
                }
            }
            var diffMS = performance.now() - start;
            diffMS = Decimals(diffMS, 1);
            console.log('Finished frame ' + startFrameId + ' with ' + totalCalls + ' call(s) in ' + diffMS + 'ms.');

            return hasMore;
        }

        function NextCall() {
            var frames = recording.frames;
            var calls = frames[curFrameId];
            if (calls === undefined)
                return false;

            var call = calls[curCallId];
            RunCall(call);

            curCallId += 1;
            if (curCallId >= calls.length) {
                curCallId = 0;
                curFrameId += 1;
            }

            return true;
        }

        function SetPos(frameId, callId) {
            curFrameId = frameId;
            curCallId = callId;
        }

        function RemapArg(arg) {
            if (!(arg instanceof Object))
                return arg;

            if (arg instanceof Array)
                return arg.map(RemapArg);

            if (arg.constructor === CRemapId)
                return GetRemapped(arg);

            return arg;
        }
        /*
        TODO: Check during playback that retvals are what we expect from the recording.
        function IsRetEqual(a, b) {
        if (!(arg instanceof Object))
        return a == b;
        }
        */
        function RunCall(call) {
            if (LOG_REPLAYED_CALLS) {
                console.log('RunCall: ' + call);
            }

            var obj = GetRemapped(call.objId);
            var funcName = call.funcName;
            var args = RemapArg(call.args);

            if (call.funcName == 'getContext') {
                if (args.length == 1) {
                    args.push({});
                }
                args[1].preserveDrawingBuffer = true;
            }

            ////////

            var func = obj[funcName];
            var ret = func.apply(obj, args);

            ////////

            if (funcName.startsWith('create') ||
                funcName == 'getExtension' ||
                funcName == 'getContext' ||
                funcName == 'getUniformLocation')
            {
                SetRemapped(call.ret, ret);
            } else if (funcName == 'getUniformIndices') {
                ASSERT(ret.length == call.ret,
                       'funcName: getUniformIndices returned an unexpected length.');

                for (var i in ret) {
                    SetRemapped(call.ret[i], ret[i]);
                }
            }
        }

        return {
            Canvases: Canvases,
            NextFrame: NextFrame,
            NextCall: NextCall,
            SetPos: SetPos,
            FrameId: function() { return curFrameId; },
            CallId: function() { return curCallId; },
        };
    }

    ////////////////////////////////////////////////////////////////////////////

    if (!(DISABLE_ATTACH_VAR in window)) {
        PatchForRecording();

        var framesToRecord = DEFAULT_FRAMES_TO_RECORD;
        console.log('WebGLRR now recording for ' + framesToRecord + ' frame(s). (disable by setting "window.' + DISABLE_ATTACH_VAR + '" before script load)');
        Record(framesToRecord);
    }

    return {
        Download: Download,
        Dump: Dump,
        Export: Export,
        Record: Record,
        LoadReplay: LoadReplay,
    };
})();
