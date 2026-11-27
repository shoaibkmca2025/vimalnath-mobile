-- The cutlist systems carry their profile size in their names, as the shop asked (27 Nov 2026). Only names still at a
-- default are changed: a name someone typed in the admin is left as it is.
update cutlist_systems set name = '16 × 35 Telescopic Sliding'
  where id = 'telescopic' and name in ('Telescopic Sliding', '16 × 35 Telescopic Sliding System');
update cutlist_systems set name = '16 × 35 Synchronized System'
  where id = 'synchronized' and name in ('Synchronized System', '16 × 35 Synchronized Sliding System');
update cutlist_systems set name = '12 × 45 Sliding Folding System'
  where id = 'folding' and name = 'Sliding Folding System';
