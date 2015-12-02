const React = require("react");
const GL = require("gl-react");
const { Surface } = require("gl-react-dom");

class Transition extends React.Component {
  render () {
    const { width, height, shader, progress, from, to, uniforms } = this.props;
    const scale = window.devicePixelRatio;
    return <Surface width={width} height={height} opaque={false}>
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
