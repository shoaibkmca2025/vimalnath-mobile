/**
 * Installation videos shown under Menu › Installation Videos. Each `url` opens in the YouTube app (or the
 * browser). Until Vimalnath's own video links are added, entries open a YouTube search for the topic;
 * to use a specific video, replace `url` with its link, e.g. 'https://www.youtube.com/watch?v=VIDEO_ID'.
 */
export type InstallationVideo = { title: string; detail: string; url: string };

const youtubeSearch = (query: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

export const installationVideoSections: { title: string; videos: InstallationVideo[] }[] = [
  {
    title: 'Sliding systems',
    videos: [
      { title: 'Telescopic Sliding System', detail: '1+0 to 4+1 telescopic glass sliding doors', url: youtubeSearch('telescopic sliding glass door system installation') },
      { title: 'Synchronized Sliding System', detail: 'Synchro sliding doors that open together', url: youtubeSearch('synchronized sliding glass door system installation') },
      { title: 'Sliding Folding System', detail: '2 to 10 door folding glass systems', url: youtubeSearch('sliding folding glass door system installation') },
    ],
  },
  {
    title: 'Glass hardware',
    videos: [
      { title: 'Patch Fittings', detail: 'Top and bottom patches for glass doors', url: youtubeSearch('glass door patch fitting installation') },
      { title: 'Floor Spring', detail: 'Floor spring for frameless glass doors', url: youtubeSearch('floor spring installation glass door') },
      { title: 'Door Closer', detail: 'Overhead hydraulic door closer', url: youtubeSearch('hydraulic door closer installation') },
      { title: 'Shower Cubicle', detail: 'Frameless glass shower enclosure', url: youtubeSearch('frameless glass shower cubicle installation') },
    ],
  },
  {
    title: 'Partitions',
    videos: [{ title: 'Office Glass Partition', detail: 'Aluminium profile glass partition', url: youtubeSearch('aluminium glass office partition installation') }],
  },
];
