const path = require('path');

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// ./admin and ./server are separate projects with their own node_modules; keep Metro from crawling
// them. Added to Expo's own block list rather than replacing it.
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const separateProjects = ['admin', 'server'].map((dir) => new RegExp(`^${escape(path.resolve(__dirname, dir))}[\\\\/].*`));
const existing = config.resolver.blockList;
config.resolver.blockList = [...(Array.isArray(existing) ? existing : existing ? [existing] : []), ...separateProjects];

module.exports = config;
