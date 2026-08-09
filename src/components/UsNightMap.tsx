// The nighttime United States behind the business-hours widget.
//
// Decoration, and the only picture in the app. It is here because the widget it
// sits behind is the one panel that is about somewhere else — four zones of
// other people's daylight — and a map is what that is a picture of.
//
// It is a raster, and that is the point of it. This started as vector artwork
// drawn live in the browser and it read as vector artwork: flat fills, clean
// edges, no weather. What it needed was terrain, cloud and grain, and those are
// things you render rather than draw. So the scene is built once, offline, and
// what ships is the photograph of it.
//
// ─── Where the image comes from ───────────────────────────────────────────
//
// tools/us-night-map.generator.html builds the whole scene and
// public/us-night-map.jpg is a screenshot of it at 2000x1025. Nothing at
// runtime depends on the generator; it is in the repo so the asset can be
// re-made and audited rather than being a picture of unknown origin.
//
// The scene is assembled from things that are either real or procedural, and
// nothing else:
//
//   Geometry — the US Census Bureau's own cartographic boundary data (public
//   domain, by way of the us-atlas package), projected to Albers USA. The
//   coastline, the Great Lakes and the state lines are the real ones.
//
//   City lights — 66 real metros, each scattered into a spill of smaller
//   lights, so the eastern seaboard crowds and the mountain west goes dark
//   the way it actually does.
//
//   Terrain — fractal noise driven through a diffuse-lighting filter lit from
//   the north-west. That is what turns a flat fill into a surface with relief
//   on it, and it is why the land no longer looks drawn.
//
//   Weather — two more turbulence layers at different frequencies, one for
//   fronts and one for detail.
//
//   The limb and the atmosphere — the horizon is the edge of a very large
//   circle, with the blue band along it blurred over the cut, so the country
//   sits on a globe rather than on a rectangle.
//
// No third-party imagery is involved, so there is no licence here to take on
// trust: every pixel is either public-domain geometry or noise this repo
// generated.
//
// ─── How it sits in the widget ────────────────────────────────────────────
//
// It is the bottom layer and it stays there. The header and the four timezone
// tiles are the panel's subject; this is the room they are in. It is held well
// back — dimmed as a whole, faded out on every edge, and faded hardest along
// the bottom where the tiles sit over it — so it reads at a glance and never
// competes with a time somebody is trying to read.
//
// aria-hidden: nothing is measured off it and no data feeds it.

export default function UsNightMap() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {/* The image itself. object-cover with the focus a little above centre:
          the country sits in the upper two-thirds of the frame, and centring it
          would push the limb and its atmosphere off the top. */}
      <img
        src="/us-night-map.jpg"
        alt=""
        className="h-full w-full object-cover object-[50%_42%]"
      />

      {/* Depth, in two passes over the top. Vertical: the band between the
          header and the tiles is the part meant to be seen and is left nearly
          alone; the top takes a wash so the header reads over it, and the
          bottom takes a heavier one because the tiles sit there and a time
          somebody is trying to read has to win. Horizontal: both edges soften
          into the container so the picture is embedded in the panel rather than
          cropped and pasted into it. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to bottom, rgba(9,29,58,0.58) 0%, rgba(9,29,58,0.2) 20%, rgba(9,29,58,0) 44%, rgba(9,29,58,0.18) 70%, rgba(7,23,48,0.52) 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(9,29,58,0.72) 0%, rgba(9,29,58,0) 15%, rgba(9,29,58,0) 85%, rgba(9,29,58,0.72) 100%)",
        }}
      />
    </div>
  );
}
