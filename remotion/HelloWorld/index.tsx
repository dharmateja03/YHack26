import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

interface HelloWorldProps {
  titleText?: string;
  titleColor?: string;
}

export const HelloWorld: React.FC<HelloWorldProps> = ({
  titleText = 'Welcome to Remotion',
  titleColor = '#000000',
}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  const opacity = interpolate(
    frame,
    [0, 30],
    [0, 1],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );

  const scale = spring({
    fps,
    frame,
    config: {
      mass: 0.5,
      damping: 10,
      stiffness: 100,
    },
  });

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'white',
      }}
    >
      <div
        style={{
          fontSize: 60,
          fontWeight: 'bold',
          color: titleColor,
          opacity,
          transform: `scale(${scale})`,
        }}
      >
        {titleText}
      </div>
    </AbsoluteFill>
  );
};
