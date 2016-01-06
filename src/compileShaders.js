
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

Shaders.on("add", (id, shader, onCompile) => {
  try {
    const res = checkCompiles(shader);
    if (onCompile) onCompile(null, res);
  }
  catch (e) {
    if (onCompile) onCompile(e.rawError || e.message);
    else throw e;
  }
});
