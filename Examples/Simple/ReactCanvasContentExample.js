import React from "react";
import Slide2D from "react-slide2d";

class ReactCanvasContentExample extends React.Component {
  render () {
    const { width, height, text } = this.props;
    return <Slide2D width={width} height={height}>{{
      background: "#000",
      size: [ 300, 169 ],
      draws: [
        [ "drawImage", "http://i.imgur.com/qVxHrkY.jpg", 0, 0, 300, 169 ],
        {
          textAlign: "center",
          fillStyle: "#f16",
          font: "24px normal"
        },
        [ "fillText", "Throw me to the wolves\nand I will return\n"+text, 150, 100, 24 ]
      ]
    }}</Slide2D>;
  }
}

module.exports = ReactCanvasContentExample;
