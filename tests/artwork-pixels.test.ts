import test from 'node:test'
import assert from 'node:assert/strict'
import {
  processArtworkPixels,
  vectorizeArtwork,
  type Pixels,
} from '../shared/artwork-pixels.ts'
import {
  artworkProblem,
  defaultLayout,
  defaultProcessing,
  cleanArtwork,
} from '../shared/product-artwork.ts'

function fixture(width = 64, height = 64): Pixels {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4).fill(255),
  }
}
function put(input: Pixels, x: number, y: number, color: number[]) {
  input.data.set(color, (y * input.width + x) * 4)
}
function pixel(input: Pixels, x: number, y: number) {
  return [
    ...input.data.slice(
      (y * input.width + x) * 4,
      (y * input.width + x) * 4 + 4,
    ),
  ]
}
function codexLike() {
  const input = fixture()
  for (let y = 16; y < 48; y++)
    for (let x = 16; x < 48; x++)
      put(input, x, y, [60 + (x - 16) * 3, 70, 235 - (x - 16), 255])
  for (let y = 28; y < 34; y++)
    for (let x = 25; x < 39; x++) put(input, x, y, [255, 255, 255, 255])
  return input
}

test('border-connected cleaning preserves enclosed white symbols and every interior gradient colour', () => {
  const input = codexLike(),
    before = new Uint8ClampedArray(input.data)
  const output = processArtworkPixels(input, {
    ...defaultProcessing(),
    trim: false,
  })
  assert.equal(output.background, 'removed')
  assert.equal(pixel(output, 0, 0)[3], 0)
  for (let y = 16; y < 48; y++)
    for (let x = 16; x < 48; x++)
      assert.deepEqual(pixel(output, x, y), pixel(input, x, y))
  assert.deepEqual(pixel(output, 30, 30), [255, 255, 255, 255])
  assert.deepEqual(input.data, before, 'source pixels are never mutated')
})
test('transparent crop retains a small safety border and enlarges the useful subject without stretching it', () => {
  const output = processArtworkPixels(codexLike(), defaultProcessing())
  assert.equal(output.width, 36)
  assert.equal(output.height, 36)
  assert.equal(output.cropped, true)
  assert.deepEqual(pixel(output, 16, 16), [255, 255, 255, 255])
  assert.equal(pixel(output, 0, 0)[3], 0)
})
test('uncertain multicolour/photo borders and uniformly blank images are kept', () => {
  const photo = fixture()
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++)
      put(photo, x, y, [x * 4, y * 4, (x + y) * 2, 255])
  for (const input of [photo, fixture()]) {
    const output = processArtworkPixels(input, defaultProcessing())
    assert.equal(output.background, 'kept')
    assert.deepEqual(output.data, input.data)
  }
})
test('disabling removal restores opaque source colours; transparent inputs still trim safely', () => {
  const input = codexLike()
  const untouched = processArtworkPixels(input, {
    ...defaultProcessing(),
    removeBackground: false,
  })
  assert.deepEqual(untouched.data, input.data)
  for (let i = 0; i < input.data.length; i += 4)
    if (
      input.data[i] === 255 &&
      input.data[i + 1] === 255 &&
      input.data[i + 2] === 255
    )
      input.data[i + 3] = 0
  const output = processArtworkPixels(input, defaultProcessing())
  assert.equal(output.background, 'transparent')
  assert.equal(output.width, 36)
})
test('edge decontamination removes a simple white matte without altering interior pixels', () => {
  const input = fixture(32, 32)
  for (let y = 8; y < 24; y++)
    for (let x = 8; x < 24; x++) put(input, x, y, [50, 60, 220, 255])
  for (let x = 9; x < 23; x++) put(input, x, 7, [153, 158, 238, 255])
  const output = processArtworkPixels(input, {
    ...defaultProcessing(),
    trim: false,
  })
  const edge = pixel(output, 14, 7)
  assert.deepEqual(edge.slice(0, 3), [50, 60, 220])
  assert.ok(edge[3] > 120 && edge[3] < 140)
  assert.deepEqual(pixel(output, 14, 8), [50, 60, 220, 255])
})
test('isolated outer specks are removed while tiny interior details remain', () => {
  const input = codexLike()
  put(input, 1, 1, [30, 30, 30, 255])
  put(input, 33, 32, [0, 0, 0, 255])
  const output = processArtworkPixels(input, {
    ...defaultProcessing(),
    trim: false,
  })
  assert.equal(pixel(output, 1, 1)[3], 0)
  assert.deepEqual(pixel(output, 33, 32), [0, 0, 0, 255])
})
test('vector tracing keeps solid logo colours and holes, rejects gradients and excessive complexity', () => {
  const logo = fixture(32, 32)
  for (let i = 3; i < logo.data.length; i += 4) logo.data[i] = 0
  for (let y = 6; y < 26; y++)
    for (let x = 6; x < 26; x++) put(logo, x, y, [40, 60, 200, 255])
  for (let y = 12; y < 20; y++)
    for (let x = 12; x < 20; x++) put(logo, x, y, [255, 255, 255, 255])
  const vector = vectorizeArtwork(logo)!
  assert.ok(vector)
  assert.equal(vector.paths.length, 2)
  assert.deepEqual(vector.paths.map((p) => p.fill).sort(), [
    '#283cc8',
    '#ffffff',
  ])
  assert.equal(
    (vector.paths.find((p) => p.fill === '#283cc8')!.d.match(/M/g) ?? [])
      .length,
    2,
    'inner outline stays a hole',
  )
  assert.equal(
    vectorizeArtwork(processArtworkPixels(codexLike(), defaultProcessing())),
    null,
  )
  assert.equal(artworkProblem({ template: 'float', image: png, vector }), null)
})
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg=='
test('new settings reject unsafe vector markup, CSS injection and unbounded geometry; old configs stay identical', () => {
  const old = { template: 'float' as const, image: png }
  assert.deepEqual(cleanArtwork(old), old)
  assert.equal(artworkProblem(old), null)
  for (const extra of [
    { layout: { ...defaultLayout(), scale: Infinity } },
    { layout: { ...defaultLayout(), x: 41 } },
    {
      layout: {
        ...defaultLayout(),
        backgroundColor: 'url(https://foreign.test)',
      },
    },
    { processing: { ...defaultProcessing(), removeBackground: 'yes' } },
    { processing: { ...defaultProcessing(), tolerance: 200 } },
    { source: 'https://foreign.test/image.png' },
    {
      vector: {
        width: 32,
        height: 32,
        paths: [{ fill: '#ffffff', d: 'M0,0L1,1Z<script>alert(1)</script>' }],
      },
    },
    {
      vector: {
        width: 32,
        height: 32,
        paths: [{ fill: '#ffffff', d: 'M0,0L2000,0Z' }],
      },
    },
    {
      vector: {
        width: 32,
        height: 32,
        paths: [{ fill: 'red', d: 'M0,0L1,1Z' }],
      },
    },
  ])
    assert.ok(artworkProblem({ ...old, ...extra }))
  const config = {
    ...old,
    source: png,
    processing: defaultProcessing(),
    layout: defaultLayout(),
  }
  assert.deepEqual(cleanArtwork(config, true), {
    ...old,
    layout: defaultLayout(),
  })
})
