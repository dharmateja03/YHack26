import React from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

interface OutroSlideProps {
  productName: string;
  releaseDate: string;
}

export const OutroSlide: React.FC<OutroSlideProps> = ({
  productName,
  releaseDate,
}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();

  // Background gradient animation
  const gradientProgress = interpolate(
    frame,
    [0, durationInFrames],
    [0, 1],
    {
      easing: Easing.linear,
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );

  // Product name fade in
  const nameOpacity = interpolate(
    frame,
    [20, 50],
    [0, 1],
    {
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );

  const nameY = interpolate(
    frame,
    [20, 50],
    [30, 0],
    {
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );

  // Release date fade in
  const dateOpacity = interpolate(
    frame,
    [50, 80],
    [0, 1],
    {
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );

  const dateY = interpolate(
    frame,
    [50, 80],
    [20, 0],
    {
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );

  // Price teaser fade in
  const priceOpacity = interpolate(
    frame,
    [100, 130],
    [0, 1],
    {
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: `linear-gradient(${135 + gradientProgress * 45}deg, 
          #1D1D1F 0%, 
          #2D2D2F 50%, 
          #1D1D1F 100%)`,
      }}
    >
      {/* Product Name - Large and bold */}
      <div
        style={{
          fontSize: 140,
          fontWeight: 700,
          color: '#FFFFFF',
          letterSpacing: '-0.04em',
          opacity: nameOpacity,
          transform: `translateY(${nameY}px)`,
          lineHeight: 1,
          marginBottom: 48,
          textShadow: '0 0 80px rgba(255,255,255,0.1)',
        }}
      >
        {productName}
      </div>

      {/* Release Date */}
      <div
        style={{
          fontSize: 48,
          fontWeight: 500,
          color: '#86868B',
          letterSpacing: '-0.01em',
          opacity: dateOpacity,
          transform: `translateY(${dateY}px)`,
          lineHeight: 1.2,
          marginBottom: 32,
        }}
      >
        {releaseDate}
      </div>

      {/* Starting price hint */}
      <div
        style={{
          fontSize: 32,
          fontWeight: 400,
          color: '#86868B',
          letterSpacing: '0.05em',
          opacity: priceOpacity,
          textTransform: 'uppercase',
        }}
      >
        Starting at $999
      </div>

      {/* Apple logo representation */}
      <AppleLogo frame={frame} />
    </AbsoluteFill>
  );
};

const AppleLogo: React.FC<{frame: number}> = ({frame}) => {
  const opacity = interpolate(
    frame,
    [140, 170],
    [0, 0.5],
    {
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 80,
        opacity: opacity,
        fontSize: 40,
        color: '#86868B',
        fontWeight: 600,
      }}
    >
      <svg
        width="40"
        height="40"
        viewBox="0 0 170 170"
        fill="currentColor"
      >
        <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.197-2.12-9.973-3.17-14.34-3.17-4.58 0-9.492 1.05-14.746 3.17-5.262 2.13-9.501 3.24-12.742 3.35-4.929.21-9.842-1.96-14.746-6.52-3.13-2.73-7.045-7.41-11.735-14.04-5.032-7.08-9.169-15.29-12.41-24.65-3.471-10.11-5.211-19.9-5.211-29.378 0-10.857 2.346-20.221 7.045-28.1 5.145-8.581 11.706-14.293 19.698-17.152 3.471-1.289 8.054-2.29 13.765-3.036 5.926-.845 12.662-.95 20.214-.33 6.459.575 15.996 2.384 28.597 5.425 11.897 2.816 18.473 4.246 19.727 4.286 6.531.181 12.485-2.871 17.864-9.148-4.675-2.906-8.984-6.54-12.927-10.905-5.798-6.58-10.292-14.145-13.467-22.689-3.176-8.543-4.753-17.01-4.753-25.4 0-12.109 3.062-22.994 9.193-32.652 8.332-12.846 19.307-19.269 32.924-19.269 2.716 0 5.732.4 9.056 1.208 5.268 1.261 9.229 1.965 11.886 2.123 5.397.409 10.406-.283 15.023-2.08 6.829-2.746 12.714-3.42 17.659-2.024 3.344.961 6.708 2.627 10.091 4.998 3.139 2.15 5.697 4.428 7.672 6.835 4.006 5.064 7.191 10.798 9.557 17.204 2.368 6.408 3.72 12.828 4.061 19.259.089 1.702-.015 3.483-.301 5.346-.288 1.868-.673 3.421-1.157 4.658 6.086.934 11.615 2.787 16.588 5.568 4.971 2.78 8.913 5.869 11.822 9.27-3.669 3.907-8.198 6.745-13.576 8.512-7.176 2.42-14.439 2.538-21.788.356z"/>
      </svg>
    </div>
  );
};
