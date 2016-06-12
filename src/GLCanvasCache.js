
function GLCanvasCache (gl) {
  this.gl = gl;
  this._images = {};
  this._shaders = {};
  this._fbos = {};
  this._contentTextures = [];
  this._standaloneTextures = [];

  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, -1, 4, 4, -1]), // see a-big-triangle
    gl.STATIC_DRAW
  );
  this._buffer = buffer;
}

GLCanvasCache.prototype = {
  dispose () {
    // Destroy everything to avoid leaks.
    this._contentTextures.forEach(t => t.dispose());
    this._standaloneTextures.forEach(t => t.dispose());
    [
      this._shaders,
      this._images,
      this._fbos
    ].forEach(coll => {
      for (const k in coll) {
        coll[k].dispose();
        delete coll[k];
      }
    });

    if (this.gl) this.gl.deleteBuffer(this._buffer);
    this.gl = null;
  }
};



module.exports = GLCanvasCache;
