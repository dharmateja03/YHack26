import React from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Sequence,
} from 'remotion';
import {IntroSlide} from './IntroSlide';
import {ProductReveal} from './ProductReveal';
import {FeatureShowcase} from './FeatureShowcase';
import {OneMoreThing} from './OneMoreThing';
import {OutroSlide} from './OutroSlide';

interface ProductLaunchProps {
  titleText?: string;
  productName?: string;
  tagline?: string;
  releaseDate?: string;
}

export const ProductLaunch: React.FC<ProductLaunchProps> = ({
  titleText = 'Introducing',
  productName = 'Vision',
  tagline = 'The future, delivered.',
  releaseDate = 'Available This Fall',
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  // Scene timing (in frames at 60fps)
  const introDuration = 180; // 3 seconds
  const revealDuration = 240; // 4 seconds
  const featureDuration = 300; // 5 seconds
  const oneMoreThingDuration = 120; // 2 seconds
  const outroDuration = 180; // 3 seconds

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#FAFAFA',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* Scene 1: Intro - Build anticipation */}
      <Sequence from={0} durationInFrames={introDuration}>
        <IntroSlide titleText={titleText} productName={productName} />
      </Sequence>

      {/* Scene 2: Product Reveal - The moment */}
      <Sequence from={introDuration} durationInFrames={revealDuration}>
        <ProductReveal productName={productName} tagline={tagline} />
      </Sequence>

      {/* Scene 3: Features - What makes it special */}
      <Sequence from={introDuration + revealDuration} durationInFrames={featureDuration}>
        <FeatureShowcase />
      </Sequence>

      {/* Scene 4: One More Thing - Steve's signature */}
      <Sequence from={introDuration + revealDuration + featureDuration} durationInFrames={oneMoreThingDuration}>
        <OneMoreThing surpriseText="And one more thing..." />
      </Sequence>

      {/* Scene 5: Outro - Release info */}
      <Sequence from={introDuration + revealDuration + featureDuration + oneMoreThingDuration} durationInFrames={outroDuration}>
        <OutroSlide productName={productName} releaseDate={releaseDate} />
      </Sequence>
    </AbsoluteFill>
  );
};
