import {Composition} from "remotion";
import {FixMcpDemo} from "./FixMcpDemo";

export const RemotionRoot = () => {
  return (
    <Composition
      id="FixMcpDemo"
      component={FixMcpDemo}
      durationInFrames={900}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
