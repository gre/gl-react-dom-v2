const invariant = require("invariant");
const React = require("react");
const {
  Component,
  PropTypes
} = React;
const raf = require("raf");
const now = require("performance-now");
const createShader = require("gl-shader");
const createTexture = require("gl-texture2d");
const createFBO = require("gl-fbo");
const pool = require("typedarray-pool");
const { Shaders } = require("gl-react");
const GLImage = require("./GLImage");
const vertShader = require("./static.vert");
const pointerEventsProperty = require("./pointerEventsProperty");
const canvasPool = require("./canvasPool");

const disposeFunction = o => o.dispose();

// call f(obj, key) on all objects that have disappeared from oldMap to newMap
function diffCall (newMap, oldMap, f) {
  for (const o in oldMap) {
    if (!(o in newMap)) {
      f(oldMap[o], o);
    }
  }
}

// set obj.shape only if it has changed
function syncShape (obj, shape) {
  if (obj.shape[0] !== shape[0] || obj.shape[1] !== shape[1]) {
    obj.shape = shape;
  }
}

function imageObjectToId (image) {
  return image.uri;
}

function countPreloaded (loaded, toLoad) {
  let nb = 0;
  for (let i=0; i < toLoad.length; i++) {
    if (loaded.indexOf(imageObjectToId(toLoad[i]))!==-1)
      nb ++;
  }
  return nb;
}

function extractShaderDebug (shader) {
  const { types: { uniforms } } = shader;
  return { types: { uniforms } };
}

function defer () {
  const deferred = {};
  const promise = new Promise((resolve, reject) => {
    deferred.resolve = resolve;
    deferred.reject  = reject;
  });
  deferred.promise = promise;
  return deferred;
}

class GLCanvas extends Component {

  // Life-cycle methods

  constructor (props) {
    super(props);
    this.state = {
      scale: window.devicePixelRatio
    };
    this._drawCleanups = [];
  }

  componentWillUnmount () {
    this._drawCleanups.forEach(f => f());
    this._drawCleanups = null;
    if (this._poolObject) {
      this._poolObject.dispose();
    }
    if (this._allocatedFromPool) {
      this._allocatedFromPool.forEach(pool.freeUint8);
    }
    this.setDebugProbe(null);
    this._mountPoint = null;
    this._canvas = null;
    this._gl = null;
    this._cache = null;
    if (this._rafAutoRedraw) raf.cancel(this._rafAutoRedraw);
    if (this._rafDraw) raf.cancel(this._rafDraw);
    Object.keys(this._pendingCaptureFrame).forEach(key => {
      this._pendingCaptureFrame[key].reject(new Error("GLCanvas is unmounting"));
    });
    this._pendingCaptureFrame = null;
  }

  componentWillReceiveProps (props) {
    // react on props changes only for things we can't pre-compute
    const devicePixelRatio = window.devicePixelRatio;
    if (this.state.devicePixelRatio !== devicePixelRatio) {
      this.setState({ devicePixelRatio });
    }
    if (props.nbContentTextures !== this.props.nbContentTextures)
      this._resizeUniformContentTextures(props.nbContentTextures);

    if (props.data !== this.props.data)
      this._requestSyncData();

    this._autoredraw = props.autoRedraw;
    this._syncAutoRedraw();
  }

  componentWillUpdate () {
    if (this._poolObject) {
      const { width, height } = this.props;
      const { scale } = this.state;
      this._poolObject.resize(width, height, scale);
    }
  }

  _mount (container) {
    // Create the WebGL Context and init the rendering
    this._poolObject = canvasPool.create(container);
    this._cache = this._poolObject.cache;
    const { canvas, gl, resize } = this._poolObject;
    resize(this.props.width, this.props.height, this.state.scale);
    this._canvas = canvas;

    this._dirtyOnLoad = true;
    this._preloading = Object.keys(this._cache._images);
    this._autoredraw = this.props.autoRedraw;
    this._pendingCaptureFrame = {};

    if (!gl) return;
    this._gl = gl;

    this._resizeUniformContentTextures(this.props.nbContentTextures);
    this._requestSyncData();
    this._syncAutoRedraw();
  }

  render () {
    const { width, height,
      data, nbContentTextures, imagesToPreload, renderId, opaque, onLoad, onProgress, autoRedraw, eventsThrough, visibleContent, // eslint-disable-line
      ...rest
    } = this.props;
    const styles = {
      width: width+"px",
      height: height+"px",
      [pointerEventsProperty]: eventsThrough ? "none" : "auto",
      position: "relative",
      background: opaque ? "#000" : "transparent",
      display: "inline-block"
    };
    return <div
      {...rest}
      ref={ref => {
        if (ref && !this._mountPoint) {
          this._mount(this._mountPoint = ref);
        }
      }}
      style={styles}
    />;
  }

  // Exposed methods

  captureFrame (optsOrDeprecatedCb) {
    let opts;
    if (typeof optsOrDeprecatedCb === "function") {
      console.warn("GLSurface: callback parameter of captureFrame is deprecated, use the returned promise instead"); // eslint-disable-line no-console
      promise.then(optsOrDeprecatedCb);
    }
    else if (optsOrDeprecatedCb) {
      invariant(typeof optsOrDeprecatedCb==="object", "captureFrame takes an object option in parameter");
      let nb = 0;
      if ("format" in optsOrDeprecatedCb) {
        invariant(
          typeof optsOrDeprecatedCb.format === "string",
          "captureFrame({format}): format must be a string (e.g: 'base64', 'blob'), Got: '%s'",
          optsOrDeprecatedCb.format);
        nb ++;
      }
      if ("type" in optsOrDeprecatedCb) {
        invariant(
          typeof optsOrDeprecatedCb.type === "string",
          "captureFrame({type}): type must be a string (e.g: 'png', 'jpg'), Got: '%s'",
          optsOrDeprecatedCb.type);
        nb ++;
      }
      if ("quality" in optsOrDeprecatedCb) {
        invariant(
          typeof optsOrDeprecatedCb.quality === "number" &&
          optsOrDeprecatedCb.quality >= 0 &&
          optsOrDeprecatedCb.quality <= 1,
          "captureFrame({quality}): quality must be a number between 0 and 1, Got: '%s'",
          optsOrDeprecatedCb.quality);
        nb ++;
      }
      const keys = Object.keys(optsOrDeprecatedCb);
      invariant(keys.length === nb, "captureFrame(opts): opts must be an object with {format, type, quality}, found some invalid keys in '%s'", keys);
      opts = optsOrDeprecatedCb;
    }
    opts = {
      format: "base64",
      type: "png",
      quality: 1,
      ...opts
    };
    const promise = this._addPendingCaptureFrame(opts).promise;
    this._requestDraw();
    return promise;
  }

  setDebugProbe (params) {
    // Free old
    if (this._debugProbe) {
      this._debugProbe = null;
    }
    if (params) {
      invariant(typeof params.onDraw === "function", "onDraw is required in setDebugProbe({ onDraw })");
      params = {
        profile: true,
        capture: true,
        captureRate: 0, // in ms. This can be use to throttle the capture. Careful however, you might not get the latest capture in cases where autoRedraw is not used. '0' default value means no throttle.
        // extends defaults with argument
        ...params
      };
      this._debugProbe = {
        ...params,
        lastCapture: 0
      };
      this._requestDraw();
    }
  }

  // Private methods

  _addPendingCaptureFrame (opts) {
    const key = opts.format + ":" + opts.type + ":" + opts.quality;
    return this._pendingCaptureFrame[key] || (
      this._pendingCaptureFrame[key] = { ...defer(), opts }
    );
  }

  _capture ({ format, type, quality }) {
    const canvas = this._canvas;
    try {
      switch (format) {
      case "base64": return Promise.resolve(canvas.toDataURL(type, quality));
      case "blob": return new Promise(resolve => canvas.toBlob(resolve, type, quality));
      default: invariant(false, "invalid capture format '%s'", format);
      }
    }
    catch (e) {
      return Promise.reject(e);
    }
  }

  _getFBO = id => {
    const fbos = this._cache._fbos; // pool of FBOs
    invariant(id>=0, "fbo id must be a positive integer");
    if (id in fbos) {
      return fbos[id]; // re-use existing FBO from pool
    }
    else {
      const fbo = createFBO(this._gl, [ 2, 2 ]);
      fbo.color[0].minFilter =
      fbo.color[0].magFilter =
        this._gl.LINEAR;
      fbos[id] = fbo;
      return fbo;
    }
  }

  _syncData (data) {
    // Synchronize the data props that contains every data needed for render
    const gl = this._gl;
    if (!gl) return;

    const _onImageLoad = this._onImageLoad;
    const contentTextures = this._cache._contentTextures;
    const _getFBO = this._getFBO;

    // old values
    const prevShaders = this._cache._shaders;
    const prevImages = this._cache._images;
    const prevStandaloneTextures = this._cache._standaloneTextures;

    // new values (mutated from traverseTree)
    const shaders = {}; // shaders cache (per Shader ID)
    const images = {}; // images cache (per src)
    const standaloneTextures = [];

    // traverseTree compute renderData from the data.
    // frameIndex is the framebuffer index of a node. (root is -1)
    function traverseTree (data) {
      const { shader: s, uniforms: dataUniforms, children: dataChildren, contextChildren: dataContextChildren, width, height, fboId } = data;

      const contextChildren = dataContextChildren.map(traverseTree);

      // Traverse children and compute children renderData.
      // We build a framebuffer mapping (from child index to fbo index)
      const children = dataChildren.map(traverseTree);

      // Sync shader
      let shader;
      if (s in shaders) {
        shader = shaders[s]; // re-use existing gl-shader instance
      }
      else if (s in prevShaders) {
        shader = shaders[s] = prevShaders[s]; // re-use old gl-shader instance
      }
      else {
        // Retrieve/Compiles/Prepare the shader
        const shaderObj = Shaders.get(s);
        invariant(shaderObj, "Shader #%s does not exists", s);
        shader = createShader(gl, vertShader, shaderObj.frag);
        shader.name = shaderObj.name;
        shader.attributes._p.pointer();
        shaders[s] = shader;
      }

      // extract uniforms and textures
      let uniforms = {}; // will contains all uniforms values (including texture units)
      let textures = {}; // a texture is an object with a bind() function
      let units = 0; // Starting from 0, we will affect texture units to texture uniforms
      for (const uniformName in dataUniforms) {
        const value = dataUniforms[uniformName];
        const type = shader.types.uniforms[uniformName];

        invariant(type, "Shader '%s': Uniform '%s' is not defined/used", shader.name, uniformName);

        if (type === "sampler2D" || type === "samplerCube") {
          // This is a texture
          uniforms[uniformName] = units ++; // affect a texture unit
          if (!value) {
            const emptyTexture = createTexture(gl, [ 2, 2 ]); // empty texture
            textures[uniformName] = emptyTexture;
            standaloneTextures.push(emptyTexture);
          }
          else switch (value.type) {
          case "content": // contents are DOM elements that can be rendered as texture (<canvas>, <img>, <video>)
            textures[uniformName] = contentTextures[value.id];
            break;

          case "fbo": // framebuffers are a children rendering
            const fbo = _getFBO(value.id);
            textures[uniformName] = fbo.color[0];
            break;

          case "uri":
            const src = value.uri;
            invariant(src && typeof src === "string", "Shader '%s': An image src is defined for uniform '%s'", shader.name, uniformName);
            let image;
            if (src in images) {
              image = images[src];
            }
            else if (src in prevImages) {
              image = images[src] = prevImages[src];
            }
            else {
              image = new GLImage(gl, _onImageLoad);
              images[src] = image;
            }
            image.src = src; // Always set the image src. GLImage internally won't do anything if it doesn't change
            textures[uniformName] = image.getTexture(); // GLImage will compute and cache a gl-texture2d instance
            break;

          case "ndarray":
            const tex = createTexture(gl, value.ndarray);
            const opts = value.opts || {}; // TODO: in next releases we will generalize opts to more types.
            if (!opts.disableLinearInterpolation)
              tex.minFilter = tex.magFilter = gl.LINEAR;
            textures[uniformName] = tex;
            standaloneTextures.push(tex);
            break;

          default:
            invariant(false, "Shader '%s': invalid uniform '%s' value of type '%s'", shader.name, uniformName, value.type);
          }
        }
        else {
          // In all other cases, we just copy the uniform value
          uniforms[uniformName] = value;
        }
      }

      const notProvided = Object.keys(shader.uniforms).filter(u => !(u in uniforms));
      invariant(notProvided.length===0, "Shader '%s': All defined uniforms must be provided. Missing: '"+notProvided.join("', '")+"'", shader.name);

      return { shader, uniforms, textures, children, contextChildren, width, height, fboId, data };
    }

    this._renderData = traverseTree(data);

    diffCall(images, prevImages, (img, src) => {
      const i = this._preloading.indexOf(src);
      if (i !== -1) this._preloading.splice(i, 1);
    });
    // Destroy previous states that have disappeared
    this._dispatchDrawCleanup(() => {
      diffCall(shaders, prevShaders, disposeFunction);
      diffCall(images, prevImages, disposeFunction);
      prevStandaloneTextures.forEach(disposeFunction);
    });

    this._cache._shaders = shaders;
    this._cache._images = images;
    this._cache._standaloneTextures = standaloneTextures;

    this._needsSyncData = false;
  }

  _dispatchDrawCleanup (f) {
    this._drawCleanups.push(f);
  }

  _draw () {
    this._needsDraw = false;
    const gl = this._gl;
    const renderData = this._renderData;
    if (!gl || !renderData) return;
    const {scale} = this.state;
    const _getFBO = this._getFBO;
    const buffer = this._cache._buffer;

    const allocatedFromPool = [];
    const debugProbe = this._debugProbe;
    let shouldDebugCapture = false, shouldProfile = false;
    if (debugProbe) {
      if (debugProbe.capture) {
        const t = now();
        if (t - debugProbe.lastCapture > debugProbe.captureRate) {
          debugProbe.lastCapture = t;
          shouldDebugCapture = true;
        }
      }
      shouldProfile = debugProbe.profile;
    }

    function recDraw (renderData) {
      const { shader, uniforms, textures, children, contextChildren, width, height, fboId, data } = renderData;

      const debugNode = debugProbe ? { ...data, shaderInfos: extractShaderDebug(shader) } : {};
      let profileExclusive;

      const w = width * scale, h = height * scale;

      // contextChildren are rendered BEFORE children and parent because are contextual to them
      debugNode.contextChildren = contextChildren.map(recDraw);

      // children are rendered BEFORE the parent
      debugNode.children = children.map(recDraw);

      if (shouldProfile) {
        profileExclusive = now();
      }

      let fbo;
      if (fboId === -1) {
        // special case for root FBO
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, w, h);
      }
      else {
        // Use the framebuffer of the node
        fbo = _getFBO(fboId);
        syncShape(fbo, [ w, h ]);
        fbo.bind();
      }

      // Prepare the shader/buffer
      shader.bind();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

      // Bind the textures
      for (const uniformName in textures) {
        textures[uniformName].bind(uniforms[uniformName]);
      }

      // Set the uniforms
      for (const uniformName in uniforms) {
        shader.uniforms[uniformName] = uniforms[uniformName];
      }

      // Render
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0.0, 0.0, 0.0, 0.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);


      if (shouldProfile) {
        profileExclusive = now() - profileExclusive;
        let profileInclusiveSum = 0;
        debugNode.contextChildren.forEach(({ profileInclusive }) => {
          profileInclusiveSum += profileInclusive;
        });
        debugNode.children.forEach(({ profileInclusive }) => {
          profileInclusiveSum += profileInclusive;
        });
        Object.keys(data.uniforms).forEach(key => {
          const value = data.uniforms[key];
          if (typeof value === "object" && value.type === "content")
            profileInclusiveSum += debugContents[value.id].profileExclusive;
        });
        debugNode.profileExclusive = profileExclusive;
        debugNode.profileInclusive = profileInclusiveSum + profileExclusive;
      }

      if (shouldDebugCapture) {
        var pixels = pool.mallocUint8(w * h * 4);
        allocatedFromPool.push(pixels);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        debugNode.capture = { pixels, width: w, height: h };
      }

      return debugNode;
    }

    // Draw the content to contentTextures (assuming they ALWAYS change and need a re-_syncData)
    const contents = this._getDrawingUniforms();
    const contentTextures = this._cache._contentTextures;
    const debugContents = contents.map((content, i) => {
      let profile;
      if (shouldProfile) {
        profile = now();
      }
      this._syncUniformTexture(contentTextures[i], content);
      if (shouldProfile) {
        profile = now() - profile;
      }
      if (debugProbe) {
        let capture;
        if (shouldDebugCapture) {
          capture = content; // gl-texture2d can reconciliate dom node rendering
        }
        return {
          code: content.parentNode.innerHTML,
          capture,
          profileExclusive: profile,
          profileInclusive: profile
        };
      }
    });

    // Draw everything

    gl.enable(gl.BLEND);
    const debugTree = recDraw(renderData);
    gl.disable(gl.BLEND);

    if (this._drawCleanups.length > 0) {
      this._drawCleanups.forEach(f => f());
      this._drawCleanups = [];
    }

    if (debugProbe) {
      if (this._allocatedFromPool) {
        this._allocatedFromPool.forEach(pool.freeUint8);
      }
      this._allocatedFromPool = allocatedFromPool;
      debugProbe.onDraw({
        tree: debugTree,
        contents: debugContents,
        Shaders
      });
    }

    const _pendingCaptureFrame = this._pendingCaptureFrame;
    const pendingCaptureFramePerOption = Object.keys(_pendingCaptureFrame);
    if (pendingCaptureFramePerOption.length > 0) {
      pendingCaptureFramePerOption.forEach(key => {
        const {opts, resolve, reject} = _pendingCaptureFrame[key];
        this._capture(opts).then(resolve, reject);
      });
      this._pendingCaptureFrame = {};
    }

    if (this._dirtyOnLoad && !this._haveRemainingToPreload()) {
      this._dirtyOnLoad = false;
      if (this.props.onLoad) {
        this.props.onLoad();
      }
    }
  }

  _haveRemainingToPreload () {
    return this.props.imagesToPreload.some(o => this._preloading.indexOf(imageObjectToId(o)) === -1);
  }

  _onImageLoad = loadedObj => {
    this._preloading.push(loadedObj);
    const {imagesToPreload, onProgress} = this.props;
    const loaded = countPreloaded(this._preloading, imagesToPreload);
    const total = imagesToPreload.length;
    if (onProgress) onProgress({
      progress: loaded / total,
      loaded,
      total
    });
    this._dirtyOnLoad = true;
    this._requestSyncData();
  }

  _resizeUniformContentTextures (n) { // Resize the pool of textures for the contentTextures
    const gl = this._gl;
    const contentTextures = this._cache._contentTextures;
    const length = contentTextures.length;
    if (length === n) return;
    if (n < length) {
      for (let i = n; i < length; i++) {
        contentTextures[i].dispose();
      }
      contentTextures.length = n;
    }
    else {
      for (let i = contentTextures.length; i < n; i++) {
        const texture = createTexture(gl, [ 2, 2 ]);
        texture.minFilter = texture.magFilter = gl.LINEAR;
        contentTextures.push(texture);
      }
    }
  }

  _getDrawingUniforms () {
    const {nbContentTextures} = this.props;
    if (nbContentTextures === 0) return [];
    const children = this._mountPoint.parentNode.children;
    const all = [];
    for (var i = 0; i < nbContentTextures; i++) {
      all[i] = children[i].firstChild;
    }
    return all;
  }

  _syncAutoRedraw () {
    if (!this._autoredraw || this._rafAutoRedraw) return;
    const loop = () => {
      if (!this._autoredraw) {
        delete this._rafAutoRedraw;
        return;
      }
      this._rafAutoRedraw = raf(loop);
      this._draw();
    };
    this._rafAutoRedraw = raf(loop);
  }

  _syncUniformTexture (texture, content) {
    const width = content.width || content.videoWidth;
    const height = content.height || content.videoHeight;
    if (width && height) { // ensure the resource is loaded
      syncShape(texture, [ width, height ]);
      texture.setPixels(content);
    }
    else {
      texture.shape = [ 2, 2 ];
    }
  }

  _requestSyncData () {
    this._needsSyncData = true;
    this._requestDraw();
  }

  _requestDraw () {
    if (this._rafDraw) return;
    this._rafDraw = raf(this._handleDraw);
  }

  _handleDraw = () => {
    delete this._rafDraw;
    if (this._needsSyncData) {
      this._syncData(this.props.data);
    }
    if (!this._haveRemainingToPreload()) {
      this._draw();
    }
  }
}

GLCanvas.propTypes = {
  width: PropTypes.number.isRequired,
  height: PropTypes.number.isRequired,
  data: PropTypes.object.isRequired,
  nbContentTextures: PropTypes.number.isRequired
};

module.exports = GLCanvas;
