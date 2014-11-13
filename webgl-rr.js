'use strict';

window.WebGLRR = (function(){
    var TAG_NAMESPACE = 'webglrr';
    var DISABLE_ATTACH_VAR = 'WEBGLRR_DISABLE_ATTACH';
    var DEFAULT_FRAMES_TO_RECORD = 60;
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

        var buffer;
        if (ctorName == 'ArrayBuffer') {
            buffer = obj;
        } else {
            buffer = obj.buffer;
        }

        var byteArr = new Uint8Array(buffer);
        var arr = Array.slice(byteArr);

        return {
            __as: ctorName,
            arr: arr,
        };
    }

    function TypedArrayFromJSON(json) {
        var ctorName = json.__as;
        var byteArr = new Uint8Array(json.arr);

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

        if (kTypedArrayCtors.indexOf(ctor) != -1)
            return anyVal.slice();

        if (kMediaElemCtors.indexOf(ctor) != -1) {
            var ret = TagForRemap(anyVal);

            var media = CMediaSnapshot.From(anyVal);
            mediaSnapshots[ret.id] = media;

            return ret;
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

    function RecordCall(thisObj, funcName, args, ret) {
        if (!framesStillToRecord)
            return;

        if (funcName == 'getContext' && args[0] == '2d')
            return;

        var thisRemapId = TagForRemap(thisObj);
        //console.log(thisRemapId.toString() + '.' + funcName);

        var argArray = Array.prototype.slice.call(args); // Otherwise is of type Arguments.
        var pickledArgs = Pickle(argArray);

        var pickledRet = Pickle(ret);

        var call = new CCall(thisRemapId, funcName, pickledArgs, pickledRet);
        curFrameArr.push(call);

        if (LOG_RECORDED_CALLS) {
            console.log(call.toString());
        }

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
    }

    ////////////////////////////////////////////////////////////////////////////

    function PatchProtoFunc(primClass, funcName) {
        var old = primClass.prototype[funcName];
        if (old === undefined)
            throw new Error(primClass + ' has no member ' + funcName);

        var patch = function() {
            var args = arguments; // Magic indentifier!
            var ret = old.apply(this, args);

            RecordCall(this, funcName, args, ret);

            return ret;
        };
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
        var recording = Deserialize(jsonText);

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
            ASSERT(obj !== undefined, 'Undefined active object: ' + remapId);
            return obj;
        }

        function NextFrame() {
            var endFrameId = curFrameId + 1;

            while (curFrameId < endFrameId) {
                if (!NextCall())
                    return false;
            }

            return true;
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

        function RemapArg(arg) {
            if (!(arg instanceof Object))
                return arg;

            if (arg instanceof Array)
                return arg.map(RemapArg);

            if (arg.constructor.name == 'CRemapId')
                return GetRemapped(arg);

            if (arg.constructor.name == 'CMediaSnapshot') {
                var i = document.createElement('img');
                i.src = arg.dataURL;
                return i;
            }

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
            var args = RemapArg(call.args);

            if (call.funcName == 'getContext') {
                if (args.length == 1) {
                    args.push({});
                }
                args[1].preserveDrawingBuffer = true;
            }

            var funcName = call.funcName;
            var func = obj[funcName];
            var ret = func.apply(obj, args);

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
