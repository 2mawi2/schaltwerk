import React from 'react'
import { AsciiBuilderLogo } from '../home/AsciiBuilderLogo'

interface AnimatedTextProps {
  text: string
  colorClassName?: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  paused?: boolean
  className?: string
  idleMode?: 'artifact' | 'artifact+pulse' | 'pulse' | 'wobble' | 'still'
  centered?: boolean
}

const textToAsciiMap: Record<string, string> = {
  'loading': `╦  ╔═╗╔═╗╔╦╗╦╔╗╔╔═╗
║  ║ ║╠═╣ ║║║║║║║ ╦
╩═╝╚═╝╩ ╩═╩╝╩╝╚╝╚═╝`,
  'starting': `╔═╗╔╦╗╔═╗╦═╗╔╦╗╦╔╗╔╔═╗
╚═╗ ║ ╠═╣╠╦╝ ║ ║║║║║ ╦
╚═╝ ╩ ╩ ╩╩╚═ ╩ ╩╝╚╝╚═╝`,
  'waiting': `╦ ╦╔═╗╦╔╦╗╦╔╗╔╔═╗
║║║╠═╣║ ║ ║║║║║ ╦
╚╩╝╩ ╩╩ ╩ ╩╝╚╝╚═╝`,
  'converting': `╔═╗╔═╗╔╗╔╦  ╦╔═╗╦═╗╔╦╗╦╔╗╔╔═╗
║  ║ ║║║║╚╗╔╝║╣ ╠╦╝ ║ ║║║║║ ╦
╚═╝╚═╝╝╚╝ ╚╝ ╚═╝╩╚═ ╩ ╩╝╚╝╚═╝`,
  'marking': `╔╦╗╔═╗╦═╗╦╔═╦╔╗╔╔═╗
║║║╠═╣╠╦╝╠╩╗║║║║║ ╦
╩ ╩╩ ╩╩╚═╩ ╩╩╝╚╝╚═╝`,
  'connecting': `╔═╗╔═╗╔╗╔╔╗╔╔═╗╔═╗╔╦╗╦╔╗╔╔═╗
║  ║ ║║║║║║║║╣ ║   ║ ║║║║║ ╦
╚═╝╚═╝╝╚╝╝╚╝╚═╝╚═╝ ╩ ╩╝╚╝╚═╝`,
  'deleting': `╔╦╗╔═╗╦  ╔═╗╔╦╗╦╔╗╔╔═╗
 ║║║╣ ║  ║╣  ║ ║║║║║ ╦
═╩╝╚═╝╩═╝╚═╝ ╩ ╩╝╚╝╚═╝`,
  'creating': `╔═╗╦═╗╔═╗╔═╗╔╦╗╦╔╗╔╔═╗
║  ╠╦╝║╣ ╠═╣ ║ ║║║║║ ╦
╚═╝╩╚═╚═╝╩ ╩ ╩ ╩╝╚╝╚═╝`,
  'initialising': `╦╔╗╔╦╔╦╗╦╔═╗╦  ╦╔═╗╦╔╗╔╔═╗
║║║║║ ║ ║╠═╣║  ║╚═╗║║║║║ ╦
╩╝╚╝╩ ╩ ╩╩ ╩╩═╝╩╚═╝╩╝╚╝╚═╝`,
  'initializing': `╦╔╗╔╦╔╦╗╦╔═╗╦  ╦╔═╗╦╔╗╔╔═╗
║║║║║ ║ ║╠═╣║  ║╔═╝║║║║║ ╦
╩╝╚╝╩ ╩ ╩╩ ╩╩═╝╩╚═╝╩╝╚╝╚═╝`,
}

function stringToSimpleAscii(text: string): string {
  const chars: Record<string, string[]> = {
    'a': ['╔═╗', '╠═╣', '╩ ╩'],
    'b': ['╔╗ ', '╠╩╗', '╚═╝'],
    'c': ['╔═╗', '║  ', '╚═╝'],
    'd': ['╔╦╗', '║║║', '╚═╝'],
    'e': ['╔═╗', '║╣ ', '╚═╝'],
    'f': ['╔═╗', '╠╣ ', '╩  '],
    'g': ['╔═╗', '║ ╦', '╚═╝'],
    'h': ['╦ ╦', '╠═╣', '╩ ╩'],
    'i': ['╦', '║', '╩'],
    'j': ['  ╦', '  ║', '╚═╝'],
    'k': ['╦╔═', '╠╩╗', '╩ ╩'],
    'l': ['╦  ', '║  ', '╚═╝'],
    'm': ['╔╦╗', '║║║', '╩ ╩'],
    'n': ['╔╗╔', '║║║', '╝╚╝'],
    'o': ['╔═╗', '║ ║', '╚═╝'],
    'p': ['╔═╗', '╠═╝', '╩  '],
    'q': ['╔═╗', '║ ║', '╚═╩'],
    'r': ['╦═╗', '╠╦╝', '╩╚═'],
    's': ['╔═╗', '╚═╗', '╚═╝'],
    't': ['╔╦╗', ' ║ ', ' ╩ '],
    'u': ['╦ ╦', '║ ║', '╚═╝'],
    'v': ['╦ ╦', '║ ║', '╚═╝'],
    'w': ['╦ ╦', '║║║', '╚╩╝'],
    'x': ['═╦╦', ' ╬╬', '═╩╩'],
    'y': ['╦ ╦', '╚╦╝', ' ╩ '],
    'z': ['╔═╗', '╔═╝', '╚═╝'],
    '.': [' ', ' ', '█'],
    ' ': ['  ', '  ', '  ']
  }

  const words = text.toLowerCase().split(' ')
  const lines = ['', '', '']

  for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
    const word = words[wordIndex]
    
    if (wordIndex > 0) {
      // Add spacing between words
      lines[0] += '  '
      lines[1] += '  '
      lines[2] += '  '
    }
    
    for (const char of word) {
      const asciiChar = chars[char] || chars[' ']
      lines[0] += asciiChar[0] + ' '
      lines[1] += asciiChar[1] + ' '
      lines[2] += asciiChar[2] + ' '
    }
  }

  return lines.join('\n')
}

export const AnimatedText: React.FC<AnimatedTextProps> = ({
  text,
  colorClassName = 'text-cyan-400',
  size = 'sm',
  paused = false,
  className = '',
  idleMode = 'artifact',
  centered = true
}) => {
  const sizeClasses = {
    xs: 'text-[3px]',
    sm: 'text-[4px]',
    md: 'text-[5px]',
    lg: 'text-[6px]',
    xl: 'text-[7px]'
  }

  // First check if we have a predefined ASCII art for this text
  const normalizedText = text.toLowerCase().replace(/[^\w\s]/g, '').trim()
  let asciiArt = textToAsciiMap[normalizedText]
  
  // If not found, try to match partial words (like "loading..." -> "loading")
  if (!asciiArt) {
    for (const [key, art] of Object.entries(textToAsciiMap)) {
      if (normalizedText.includes(key)) {
        asciiArt = art
        break
      }
    }
  }
  
  // If still not found, generate simple ASCII
  if (!asciiArt) {
    asciiArt = stringToSimpleAscii(normalizedText)
  }

  return (
    <div className={`flex ${centered ? 'justify-center' : ''} items-center ${className}`}>
      <div className={sizeClasses[size]}>
        <AsciiBuilderLogo
          asciiArt={asciiArt}
          colorClassName={colorClassName}
          paused={paused}
          idleMode={idleMode}
          groupOrder="center-out"
          fallDurationMs={400}
          settleDurationMs={600}
          groupGapMs={80}
          idleArtifactMagnitude={2.8}
          idleArtifactMinDelayMs={1200}
          idleArtifactMaxDelayMs={2000}
        />
      </div>
    </div>
  )
}