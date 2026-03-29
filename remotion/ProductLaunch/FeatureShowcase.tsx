import React from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

interface Feature {
  icon: string;
  title: string;
  description: string;
}

const features: Feature[] = [
  {
    icon: '⚡',
    title: 'Fast',
    description: 'Blazing performance that changes everything.',
  },
  {
    icon: '✨',
    title: 'Beautiful',
    description: 'Crafted with obsessive attention to detail.',
  },
  {
    icon: '🛡️',
    title: 'Secure',
    description: 'Your privacy is built in from the start.',
  },
];

export const FeatureShowcase: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  // Title animations
  const titleOpacity = interpolate(
    frame,
    [0, 30],
    [0, 1],
    {
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );

  const titleY = spring({
    fps,
    frame,
    config: {
      damping: 20,
      mass: 1,
      stiffness: 100,
    },
  });

  // Fade out at end
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 30, durationInFrames - 10],
    [1, 0],
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
        opacity: fadeOut,
        backgroundColor: '#000000',
      }}
    >
      {/* Section Title */}
      <div
        style={{
          fontSize: 64,
          fontWeight: 700,
          color: '#FFFFFF',
          letterSpacing: '-0.02em',
          marginBottom: 120,
          opacity: titleOpacity,
          transform: `translateY(${interpolate(titleY, [0, 1], [30, 0])}px)`,
        }}
      >
        Features
      </div>

      {/* Features Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 80,
          maxWidth: 1400,
        }}
      >
        {features.map((feature, index) => (
          <FeatureCard
            key={index}
            feature={feature}
            index={index}
            frame={frame}
            fps={fps}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};

interface FeatureCardProps {
  feature: Feature;
  index: number;
  frame: number;
  fps: number;
}

const FeatureCard: React.FC<FeatureCardProps> = ({feature, index, frame, fps}) => {
  const delay = 30 + index * 15;

  // Card fade in
  const cardOpacity = interpolate(
    frame,
    [delay, delay + 30],
    [0, 1],
    {
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );

  // Card slide up
  const cardY = spring({
    fps,
    frame: frame - delay,
    config: {
      damping: 20,
      mass: 1,
      stiffness: 100,
    },
  });

  // Icon scale
  const iconScale = spring({
    fps,
    frame: frame - delay - 10,
    config: {
      damping: 12,
      mass: 1,
      stiffness: 200,
    },
  });

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        opacity: cardOpacity,
        transform: `translateY(${interpolate(cardY, [0, 1], [50, 0])}px)`,
        padding: 40,
      }}
    >
      {/* Icon */}
      <div
        style={{
          fontSize: 64,
          marginBottom: 32,
          transform: `scale(${interpolate(iconScale, [0, 1], [0, 1])})`,
        }}
      >
        {feature.icon}
      </div>

      {/* Title */}
      <div
        style={{
          fontSize: 36,
          fontWeight: 600,
          color: '#FFFFFF',
          letterSpacing: '-0.02em',
          marginBottom: 16,
          lineHeight: 1.2,
        }}
      >
        {feature.title}
      </div>

      {/* Description */}
      <div
        style={{
          fontSize: 24,
          fontWeight: 400,
          color: '#A1A1A6',
          lineHeight: 1.4,
          maxWidth: 300,
        }}
      >
        {feature.description}
      </div>
    </div>
  );
};
