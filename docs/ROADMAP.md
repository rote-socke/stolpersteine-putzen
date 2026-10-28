# Roadmap

Ideas and open points, not yet planned in detail. Move an item into the
contract and code when it is built, and delete it here.

## Features

### Areas per group

Give each group an area to clean, so groups know where they work and don't
overlap. Open questions:

- How the organizer defines an area: draw a polygon on the map, pick streets,
  or assign stones from a selection.
- Whether an area is exclusive or only a hint, and how the nearest-stone list
  treats stones outside the own area.
- How the map shows areas without hiding the stone markers.

### Reports from people without a group

Let anyone send a report about a stone without joining a group:

- a corrected position (the stone is elsewhere than the map shows),
- its cleaning state (e.g. "cleaned it while walking by"),
- other remarks (stone missing, damaged, covered).

Anonymous writes need protection against spam and vandalism. Likely shape:
reports go into a queue that the organizer reviews and accepts or rejects;
an accepted position correction overrides the KML position. Rate limiting
per IP or device.

## Open points

- The privacy note names only a contact address, no responsible person. The
  GDPR expects one; decide whether that is needed for this project.
- Location data is a snapshot of the KML (`npm run data`). New stones appear
  only after a refresh and a deploy; consider refreshing before each cleaning
  day.
