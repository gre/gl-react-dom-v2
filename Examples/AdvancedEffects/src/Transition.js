const React = require("react");
const GL = require("gl-react");
const { Surface } = require("gl-react-dom");

class Transition extends React.Component {
  render () {
    const { width, height, shader, progress, from, to, uniforms } = this.props;
    const scale = window.devicePixelRatio;
    return <Surface width={width} height={height} backgroundColor="transparent"
      preload
      onLoad={() => console.log("Transition onLoad")}
      onProgress={p => console.log("Transition onProgress", p)}>
      <GL.Node
        shader={shader}
        uniforms={{
          progress,
          from,
          to,
          ...uniforms,
          resolution: [ width * scale, height * scale ]
        }}
      />
    </Surface>;
  }
}

module.exports = Transition;
