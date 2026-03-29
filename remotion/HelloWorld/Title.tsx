import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
} from 'remotion';

interface TitleProps {
  titleText?: string;
  titleColor?: string;
}

export const Title: React.FC<TitleProps> = ({
  titleText = 'Welcome to Remotion',
  titleColor = 'black',
}) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(
    frame,
    [0, 60],
    [0, 1],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );

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
        }}
      >
        {titleText}
      </div>
    </AbsoluteFill>
  );
};
