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

function defer() {
  const deferred = {};
  const promise = new Promise(function(resolve, reject) {
    deferred.resolve = resolve;
    deferred.reject  = reject;
  });
  deferred.promise = promise;
  return deferred;
}

class GLCanvas extends Component {

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
    if (this.poolObject) {
      this.poolObject.dispose();
    }
    if (this.allocatedFromPool) {
      this.allocatedFromPool.forEach(pool.freeUint8);
    }
    this.setDebugProbe(null);
    this._mountPoint = null;
    this.canvas = null;
    this.gl = null;
    this.cache = null;
    if (this._raf) raf.cancel(this._raf);
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
      this.resizeUniformContentTextures(props.nbContentTextures);

    this._autoredraw = props.autoRedraw;
    this.checkAutoRedraw();
  }

  componentWillUpdate () {
    if (this.poolObject) {
      const { width, height } = this.props;
      const { scale } = this.state;
      this.poolObject.resize(width, height, scale);
    }
  }

  componentDidUpdate () {
    // Synchronize the rendering (after render is done)
    const { data, imagesToPreload } = this.props;
    this.syncData(data, imagesToPreload);
  }

  mount (container) {
    // Create the WebGL Context and init the rendering
    this.poolObject = canvasPool.create(container);
    this.cache = this.poolObject.cache;
    const { canvas, gl, resize } = this.poolObject;
    resize(this.props.width, this.props.height, this.state.scale);
    this.canvas = canvas;

    this._triggerOnLoad = true;
    this._preloading = Object.keys(this.cache._images);
    this._autoredraw = this.props.autoRedraw;
    this._pendingCaptureFrame = {};

    if (!gl) return;
    this.gl = gl;

    this.resizeUniformContentTextures(this.props.nbContentTextures);
    this.syncData(this.props.data, this.props.imagesToPreload);

    this.checkAutoRedraw();
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
          this.mount(this._mountPoint = ref);
        }
      }}
      style={styles}
    />;
  }

  addPendingCaptureFrame (opts) {
    const key = opts.format + ":" + opts.type + ":" + opts.quality;
    return this._pendingCaptureFrame[key] || (
      this._pendingCaptureFrame[key] = { ...defer(), opts }
    );
  }

  _capture = ({ format, type, quality }) => {
    const canvas = this.canvas;
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
    const promise = this.addPendingCaptureFrame(opts).promise;
    this.requestDraw();
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
      this.requestDraw();
    }
  }

  checkAutoRedraw () {
    if (!this._autoredraw || this._raf) return;
    const loop = () => {
      if (!this._autoredraw) {
        delete this._raf;
        return;
      }
      this._raf = raf(loop);
      this.draw();
    };
    this._raf = raf(loop);
  }

  getFBO = id => {
    const fbos = this.cache._fbos; // pool of FBOs
    invariant(id>=0, "fbo id must be a positive integer");
    if (id in fbos) {
      return fbos[id]; // re-use existing FBO from pool
    }
    else {
      const fbo = createFBO(this.gl, [ 2, 2 ]);
      fbos[id] = fbo;
      return fbo;
    }
  }

  syncData (data, imagesToPreload) {
    // Synchronize the data props that contains every data needed for render
    const gl = this.gl;
    if (!gl) return;

    const onImageLoad = this.onImageLoad;
    const contentTextures = this.cache._contentTextures;
    const getFBO = this.getFBO;

    // old values
    const prevShaders = this.cache._shaders;
    const prevImages = this.cache._images;
    const prevStandaloneTextures = this.cache._standaloneTextures;

    // new values (mutated from traverseTree)
    const shaders = {}; // shaders cache (per Shader ID)
    const images = {}; // images cache (per src)
    const standaloneTextures = [];
    let hasNewImageToPreload = false;

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
            const fbo = getFBO(value.id);
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
              if (!hasNewImageToPreload && imagesToPreload.find(o => imageObjectToId(o) === src)) {
                hasNewImageToPreload = true;
              }
              image = new GLImage(gl, onImageLoad);
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
    this.dispatchDrawCleanup(() => {
      diffCall(shaders, prevShaders, disposeFunction);
      diffCall(images, prevImages, disposeFunction);
      prevStandaloneTextures.forEach(disposeFunction);
    });

    this.cache._shaders = shaders;
    this.cache._images = images;
    this.cache._standaloneTextures = standaloneTextures;

    if (hasNewImageToPreload) {
      this._triggerOnLoad = true;
    }
    this._needsSyncData = false;
    this.requestDraw();
  }

  dispatchDrawCleanup (f) {
    this._drawCleanups.push(f);
  }

  draw () {
    this._needsDraw = false;
    const gl = this.gl;
    const renderData = this._renderData;
    if (!gl || !renderData) return;
    const {scale} = this.state;
    const getFBO = this.getFBO;
    const buffer = this.cache._buffer;

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
        fbo = getFBO(fboId);
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

    // Draw the content to contentTextures (assuming they ALWAYS change and need a re-draw)
    const contents = this.getDrawingUniforms();
    const contentTextures = this.cache._contentTextures;
    const debugContents = contents.map((content, i) => {
      let profile;
      if (shouldProfile) {
        profile = now();
      }
      this.syncUniformTexture(contentTextures[i], content);
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
      if (this.allocatedFromPool) {
        this.allocatedFromPool.forEach(pool.freeUint8);
      }
      this.allocatedFromPool = allocatedFromPool;
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

    if (this._triggerOnLoad && this.getRemainingToPreload().length === 0) {
      this._triggerOnLoad = false;
      if (this.props.onLoad) {
        this.props.onLoad();
      }
    }
  }

  getRemainingToPreload = () => {
    return this.props.imagesToPreload.map(imageObjectToId).filter(id => this._preloading.indexOf(id) === -1);
  }

  onImageLoad = loadedObj => {
    if (this.getRemainingToPreload().length > 0) {
      this._preloading.push(loadedObj);
      const {imagesToPreload, onProgress} = this.props;
      const loaded = countPreloaded(this._preloading, imagesToPreload);
      const total = imagesToPreload.length;
      if (onProgress) onProgress({
        progress: loaded / total,
        loaded,
        total
      });
      if (loaded == total) {
        this.requestSyncData();
      }
    }
    else {
      // Any texture image load will trigger a future re-sync of data (if no preloaded)
      this.requestSyncData();
    }
  }

  // Resize the pool of textures for the contentTextures
  resizeUniformContentTextures (n) {
    const gl = this.gl;
    const contentTextures = this.cache._contentTextures;
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

  syncUniformTexture (texture, content) {
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

  getDrawingUniforms () {
    const {nbContentTextures} = this.props;
    if (nbContentTextures === 0) return [];
    const children = this._mountPoint.parentNode.children;
    const all = [];
    for (var i = 0; i < nbContentTextures; i++) {
      all[i] = children[i].firstChild;
    }
    return all;
  }

  requestSyncData () {
    if (this._needsSyncData) return;
    this._needsSyncData = true;
    raf(this.handleSyncData);
  }

  handleSyncData = () => {
    if (!this._needsSyncData) return;
    this.syncData(this.props.data, this.props.imagesToPreload);
  }

  requestDraw () {
    if (this._needsDraw) return;
    this._needsDraw = true;
    raf(this.handleDraw);
  }

  handleDraw = () => {
    if (!this._needsDraw) return;
    this._needsDraw = false;
    if (this.getRemainingToPreload().length > 0) return;
    this.draw();
  }
}

GLCanvas.propTypes = {
  width: PropTypes.number.isRequired,
  height: PropTypes.number.isRequired,
  data: PropTypes.object.isRequired,
  nbContentTextures: PropTypes.number.isRequired
};

module.exports = GLCanvas;
