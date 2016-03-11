'use strict';

window.WebGLRR = (function(){
    var TAG_NAMESPACE = 'webglrr';
    var DISABLE_ATTACH_VAR = 'WEBGLRR_DISABLE_ATTACH';
    var DEFAULT_FRAMES_TO_RECORD = 3;
    var LOG_RECORDED_CALLS = false;
    var LOG_REPLAYED_CALLS = false;

    function ASSERT(cond, text='<assertion failed>') {
        if (cond)
            return;

        var e = new Error(text);
        throw e;
    }

    function HasTag(obj, tagName) {
        ASSERT(obj instanceof Object, obj.toString());

        if (!(TAG_NAMESPACE in obj))
            return false;

        if (!(tagName in obj[TAG_NAMESPACE]))
            return false;

        return true;
    }

    function GetTag(obj, tagName) {
        ASSERT(HasTag(obj, tagName));

        return obj[TAG_NAMESPACE][tagName];
    }

    function SetTag(obj, tagName, val) {
        ASSERT(!HasTag(obj, tagName));

        if (!(TAG_NAMESPACE in obj))
            obj[TAG_NAMESPACE] = {};

        obj[TAG_NAMESPACE][tagName] = val;
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

    CCall.toJSON = function(obj) {
        return {
            __as: 'CCall',
            objId: obj.objId,
            funcName: obj.funcName,
            args: obj.args,
            ret: obj.ret,
        };
    };

    CCall.fromJSON = function(json) {
        return new CCall(json.objId, json.funcName, json.args, json.ret);
    };

    ////////////////////////////////////

    function CRemapId(objTypeStr, id) {
        this.objTypeStr = objTypeStr;
        this.id = id;
    }

    CRemapId.prototype.toString = function() {
        return this.objTypeStr + '$' + this.id;
    };

    CRemapId.toJSON = function(obj) {
        return {
            __as: 'CRemapId',
            type: obj.objTypeStr,
            id: obj.id,
        };
    };

    CRemapId.fromJSON = function(json) {
        return new CRemapId(json.type, json.id);
    };

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

    var kFuncNames_GL = [
        // From the WebGL 1 spec.
        'getContextAttributes',
        'isContextLost',

        'getSupportedExtensions',
        'getExtension',

        'activeTexture',
        'attachShader',
        'bindAttribLocation',
        'bindBuffer',
        'bindFramebuffer',
        'bindRenderbuffer',
        'bindTexture',
        'blendColor',
        'blendEquation',
        'blendEquationSeparate',
        'blendFunc',
        'blendFuncSeparate',

        'bufferData',
        'bufferSubData',

        'checkFramebufferStatus',
        'clear',
        'clearColor',
        'clearDepth',
        'clearStencil',
        'colorMask',
        'compileShader',

        'compressedTexImage2D',
        'compressedTexSubImage2D',
        'copyTexImage2D',
        'copyTexSubImage2D',

        'createBuffer',
        'createFramebuffer',
        'createProgram',
        'createRenderbuffer',
        'createShader',
        'createTexture',

        'cullFace',

        'deleteBuffer',
        'deleteFramebuffer',
        'deleteProgram',
        'deleteRenderbuffer',
        'deleteShader',
        'deleteTexture',

        'depthFunc',
        'depthMask',
        'depthRange',
        'detachShader',
        'disable',
        'disableVertexAttribArray',
        'drawArrays',
        'drawElements',

        'enable',
        'enableVertexAttribArray',
        'finish',
        'flush',
        'framebufferRenderbuffer',
        'framebufferTexture2D',
        'frontFace',

        'generateMipmap',

        'getActiveAttrib',
        'getActiveUniform',
        'getAttachedShaders',

        'getAttribLocation',

        'getBufferParameter',
        'getParameter',

        'getError',

        'getFramebufferAttachmentParameter',
        'getProgramParameter',
        'getProgramInfoLog',
        'getRenderbufferParameter',
        'getShaderParameter',
        'getShaderPrecisionFormat',
        'getShaderInfoLog',

        'getShaderSource',

        'getTexParameter',

        'getUniform',

        'getUniformLocation',

        'getVertexAttrib',

        'getVertexAttribOffset',

        'hint',
        'isBuffer',
        'isEnabled',
        'isFramebuffer',
        'isProgram',
        'isRenderbuffer',
        'isShader',
        'isTexture',
        'lineWidth',
        'linkProgram',
        'pixelStorei',
        'polygonOffset',

        'readPixels',

        'renderbufferStorage',
        'sampleCoverage',
        'scissor',

        'shaderSource',

        'stencilFunc',
        'stencilFuncSeparate',
        'stencilMask',
        'stencilMaskSeparate',
        'stencilOp',
        'stencilOpSeparate',

        'texImage2D',

        'texParameterf',
        'texParameteri',

        'texSubImage2D',

        'uniform1f',
        'uniform1fv',
        'uniform1i',
        'uniform1iv',
        'uniform2f',
        'uniform2fv',
        'uniform2i',
        'uniform2iv',
        'uniform3f',
        'uniform3fv',
        'uniform3i',
        'uniform3iv',
        'uniform4f',
        'uniform4fv',
        'uniform4i',
        'uniform4iv',

        'uniformMatrix2fv',
        'uniformMatrix3fv',
        'uniformMatrix4fv',

        'useProgram',
        'validateProgram',

        'vertexAttrib1f',
        'vertexAttrib1fv',
        'vertexAttrib2f',
        'vertexAttrib2fv',
        'vertexAttrib3f',
        'vertexAttrib3fv',
        'vertexAttrib4f',
        'vertexAttrib4fv',
        'vertexAttribPointer',

        'viewport',
    ];
    var kFuncNames_GL2 = [
        // WebGL 2:',
        'copyBufferSubData',
        'getBufferSubData',

        'blitFramebuffer',
        'framebufferTextureLayer',
        'invalidateFramebuffer',
        'invalidateSubFramebuffer',
        'readBuffer',

        'renderbufferStorageMultisample',

        'texStorage2D',
        'texStorage3D',
        'texImage3D',
        'texSubImage3D',
        'copyTexSubImage3D',
        'compressedTexImage3D',
        'compressedTexSubImage3D',

        'uniform1ui',
        'uniform2ui',
        'uniform3ui',
        'uniform4ui',
        'uniform1uiv',
        'uniform2uiv',
        'uniform3uiv',
        'uniform4uiv',

        'uniformMatrix2x3fv',
        'uniformMatrix2x4fv',
        'uniformMatrix3x2fv',
        'uniformMatrix3x4fv',
        'uniformMatrix4x2fv',
        'uniformMatrix4x3fv',

        'vertexAttribI4i',
        'vertexAttribI4iv',
        'vertexAttribI4ui',
        'vertexAttribI4uiv',
        'vertexAttribIPointer',

        'vertexAttribDivisor',
        'drawArraysInstanced',
        'drawElementsInstanced',
        'drawRangeElements',

        'drawBuffers',
        'clearBufferiv',
        'clearBufferuiv',
        'clearBufferfv',
        'clearBufferfi',

        'createQuery',
        'deleteQuery',
        'isQuery',
        'beginQuery',
        'endQuery',
        'getQuery',
        'getQueryParameter',

        'createSampler',
        'deleteSampler',
        'isSampler',
        'bindSampler',
        'samplerParameteri',
        'samplerParameterf',
        'getSamplerParameter',

        'fenceSync',
        'isSync',
        'deleteSync',
        'clientWaitSync',
        'waitSync',
        'getSyncParameter',

        'createTransformFeedback',
        'deleteTransformFeedback',
        'isTransformFeedback',
        'bindTransformFeedback',
        'beginTransformFeedback',
        'endTransformFeedback',
        'transformFeedbackVaryings',
        'getTransformFeedbackVarying',
        'pauseTransformFeedback',
        'resumeTransformFeedback',

        'bindBufferBase',
        'bindBufferRange',
        'getIndexedParameter',
        'getUniformIndices',
        'getActiveUniforms',
        'getUniformBlockIndex',
        'getActiveUniformBlockParameter',
        'getActiveUniformBlockName',
        'uniformBlockBinding',

        'createVertexArray',
        'deleteVertexArray',
        'isVertexArray',
        'bindVertexArray',
    ];

    ////////////////////////////////////////////////////////////////////////////

    function TypedArrayToJSON(obj) {
        var ctorName = obj.constructor.name;

        var byteArr;
        if (ctorName == 'ArrayBuffer') {
            byteArr = new Uint8Array(obj);
        } else {
            byteArr = new Uint8Array(obj.buffer, obj.byteOffset, obj.byteLength);
        }

        var dataStr = '';
        byteArr.forEach(function(x) {
            var hex = x.toString(16);
            if (hex.length != 2) {
                hex = '0' + hex;
            }
            dataStr += hex;
        });

        return {
            __as: ctorName,
            data: dataStr,
        };
    }

    function TypedArrayFromJSON(json) {
        var ctorName = json.__as;
        var dataStr = json.data;

        ASSERT(dataStr.length % 2 == 0);
        var byteCount = dataStr.length / 2;
        //console.log('byteCount: ' + byteCount);

        var byteArr = new Uint8Array(byteCount);
        for (var i = 0; i < byteCount; i++) {
            var cur = dataStr[2*i] + dataStr[2*i+1];
            byteArr[i] = parseInt(cur, 16);
        }

        var obj = byteArr.buffer;
        if (ctorName != 'ArrayBuffer') {
            var ctor = window[ctorName];
            obj = new ctor(obj);
        }
        //console.log('done');

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
        if (!HasTag(obj, 'remapId')) {
            var objTypeStr = obj.constructor.name;
            var remapId = new CRemapId(objTypeStr, nextRemapId);
            nextRemapId += 1;

            SetTag(obj, 'remapId', remapId);
        }
        return GetTag(obj, 'remapId');
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
            if (miByteLen >= 10.0) {
                miByteLen |= 0;
                console.log('(' + curFuncName + ') slicing a ' + ctor.name + '(' + miByteLen + 'MiB)');
                dumpCurCall = true;
            }
            var ret = anyVal.slice();
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
                }
            });
        }

        ////////////

        if (funcName == 'getContext' && ret) {
            if (!HasTag(ret, 'state')) {
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

    function PatchProtoFunc(primClass, funcName) {
        var old = primClass.prototype[funcName];
        if (old === undefined)
            throw new Error(primClass + ' has no member ' + funcName);

        if ('isPatch' in old)
            return;

        var patch = function() {
            var args = arguments; // Magic indentifier!
            var ret = old.apply(this, args);

            RecordCall(this, funcName, args, ret);

            return ret;
        };

        patch.isPatch = null;
        primClass.prototype[funcName] = patch;
    }

    function GetRepeats(arr) {
        var accum = {};
        var repeats = {};
        arr.forEach(function(x) {
            if (x in accum) {
                repeats[x] = null;
            }
            accum[x] = null;
        });

        return Object.keys(repeats);
    }

    function PatchProto(primClass, funcNameList) {
        var repeats = GetRepeats(funcNameList);
        ASSERT(!repeats.length,
               'PatchProto for ' + primClass + ' had repeats: ' + repeats.join(', '));

        funcNameList.forEach(function(x) {
            PatchProtoFunc(primClass, x);
        });
    }

    function PatchForRecording() {
        PatchProtoFunc(HTMLCanvasElement, 'getContext');

        PatchProto(WebGLRenderingContext, kFuncNames_GL);

        var ctor = window.WebGL2RenderingContext;
        if (ctor !== undefined) {
            var funcNames = kFuncNames_GL.concat(kFuncNames_GL2);
            PatchProto(ctor, funcNames);
        }
    }

    ////////////////////////////////////////////////////////////////////////////

    function CClassSerializer(toJSON, fromJSON) {
        this.toJSON = toJSON;
        this.fromJSON = fromJSON;
    }

    function CJSONSerializer(serializationMap) {
        var boxName = '__reviveClass';

        function JSONReplace(k, v) {
            if (!(v instanceof Object))
                return v;

            var ctorName = v.constructor.name;
            var ser = serializationMap[ctorName];
            if (ser === undefined)
                return v;

            var json = ser.toJSON(v);
            return json;
        }

        function JSONRevive(k, v) {
            if (!(v instanceof Object))
                return v;

            var ctorName = v.__as;
            if (ctorName === undefined)
                return v;

            var ser = serializationMap[ctorName];
            if (ser === undefined) {
                console.log('ctorName "' + ctorName + '" not found in serializationMap, ignoring.');
                return v;
            }

            var clone = ser.fromJSON(v);
            return clone;
        }

        function Serialize(root, spaces=2) {
            return JSON.stringify(root, JSONReplace, spaces);
        }

        function Deserialize(str) {
            return JSON.parse(str, JSONRevive);
        }

        return {
            Serialize: Serialize,
            Deserialize: Deserialize,
        };
    }

    ////////////////////////////////////////////////////////////////////////////

    var kSerializationMap = {}; // ctorName -> CClassSerializer

    kSerializableCtors.forEach(function(ctor) {
        ASSERT('toJSON' in ctor);
        ASSERT('fromJSON' in ctor);
        var trans = new CClassSerializer(ctor.toJSON, ctor.fromJSON);
        kSerializationMap[ctor.name] = trans;
    });

    kTypedArrayCtors.forEach(function(ctor) {
        var trans = new CClassSerializer(TypedArrayToJSON, TypedArrayFromJSON);
        kSerializationMap[ctor.name] = trans;
    });

    var kSerializer = new CJSONSerializer(kSerializationMap);

    ////////////////////////////////////////////////////////////////////////////

    function DownloadText(filename, text, mimetype='text/plain') {
        var blob = new Blob([text], {type: mimetype});
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

    function MapToJSON(arr) {
        return arr.map(function(elem) {
            return kSerializer.Serialize(elem, 0);
        });
    }

    function Export() {
        var docCanvasCollection = document.getElementsByTagName('canvas');

        var canvasRecords = [];
        Array.forEach(docCanvasCollection, function(c) {
            if (!HasTag(c, 'remapId'))
                return;

            var remapId = GetTag(c, 'remapId');

            var data = {
                remapId: remapId,
                width: c.width,
                height: c.height,
            };
            canvasRecords.push(data);
        });

        var snapshotLines = [];
        for (var k in mediaSnapshots) {
            var snapshot = mediaSnapshots[k];
            var line = '"' + k + '": "' + snapshot.dataURL + '"';
            snapshotLines.push(line);
        }

        var recordedFrameJSONList = recordedFrames.map(function(callList) {
            var jsonCallList = MapToJSON(callList);
            return '    [\n      ' + jsonCallList.join(',\n      ') + '\n    ]';
        });

        // Let's do a tiny bit of formatting so it's neither a block nor a sprawling mess.
        var json = [
            '{',
            '  "canvases": [',
            '    ' + MapToJSON(canvasRecords).join(',\n    '),
            '  ],',
            '  "snapshots": {',
            '    ' + snapshotLines.join(',\n    '),
            '  },',
            '  "frames": [',
            recordedFrameJSONList.join(',\n    '),
            '  ]',
            '}',
            ''
        ];
        return json.join('\n');
    }

    function Download() {
        var json = Export();
        DownloadText('recording.json', json, 'text/json');
    }

    function Dump() {
        var json = Export();
        console.log(json);
    }

    ////////////////////////////////////////////////////////////////////////////

    function Deserialize(json) {
        var root = kSerializer.Deserialize(json);
        return root;
    }

    ////////////////////////////////////////////////////////////////////////////

    function LoadReplay(jsonText) {
        return new CReplayBase(jsonText);
    }

    function CReplayBase(jsonText) {
        //console.log(jsonText);
        var start = performance.now();

        var recording = Deserialize(jsonText);

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
            ASSERT(obj !== undefined);//, 'Undefined active object: ' + remapId);
            return obj;
        }

        function NextFrame() {
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
            diffMS = ((diffMS * 1000) | 0) / 1000;
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
