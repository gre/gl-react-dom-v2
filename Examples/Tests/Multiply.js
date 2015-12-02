const GL = require("gl-react");
const React = GL.React;
const glslify = require("glslify");

const shaders = GL.Shaders.create({
  multiply: {
    frag: glslify(`${__dirname}/multiply.frag`)
  }
});

module.exports = GL.createComponent(
  ({ width, height, children }) => {
    if (!children || children.length !== 2) throw new Error("You must provide 2 children to Multiply");
    const [t1, t2] = children;
    return <GL.Node
      shader={shaders.multiply}
      width={width}
      height={height}
      uniforms={{ t1, t2 }}
    />;
  },
  { displayName: "Multiply" });
