
const { Shaders } = require("gl-react");
const createShader = require("gl-shader");
const getContext = require("./getContext");
const vertexCode = require("./static.vert");
const mockCanvas = document.createElement("canvas");
const mockGl = getContext(mockCanvas, {});

const checkCompiles = o => {
  if (!mockGl) throw new Error("WebGL context unavailable"); // we skip validation when webgl is not supported
  const shader = createShader(mockGl, vertexCode, o.frag);
  const {uniforms} = shader.types;
  shader.dispose();
  return {uniforms};
};

Shaders.setImplementation({
  add: (id, shader) => Promise.resolve().then(() => {
    try {
      return checkCompiles(shader);
    }
    catch (e) {
      throw e.rawError || e.message;
    }
  }),
  remove: ()=>{}
});
