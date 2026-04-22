/**
 * FileViewer.jsx — Universal in-browser file viewer with PDF conversion
 *
 * Native rendering (no conversion):
 *   PDF, PNG/JPG/TIFF/BMP/GIF/WEBP/SVG → browser native
 *   MP4/WEBM/OGG → HTML5 video
 *   MP3/WAV       → HTML5 audio
 *   TXT/CSV/JSON/XML/LOG → text pre
 *   DXF           → HTML5 Canvas CAD renderer (lines, arcs, circles, polylines, text)
 *   STL / OBJ     → Three.js 3D renderer
 *
 * Server-side PDF conversion (all others):
 *   DOCX/DOC, XLSX/XLS, PPTX/PPT → python-docx / openpyxl / reportlab
 *   DWG, STP/STEP/IGES            → LibreOffice headless (if installed)
 *   Any other format              → LibreOffice fallback
 *
 * The converted PDF is cached on the server — subsequent views are instant.
 */
import { useState, useEffect, useRef } from 'react'

const NATIVE = {
  pdf:'pdf',
  png:'image',jpg:'image',jpeg:'image',gif:'image',
  bmp:'image',webp:'image',svg:'image',tiff:'image',tif:'image',
  txt:'text',csv:'text',json:'text',xml:'text',log:'text',
  md:'text',py:'text',js:'text',ts:'text',html:'text',css:'text',
  mp4:'video',webm:'video',ogg:'video',
  mp3:'audio',wav:'audio',
  dxf:'dxf',
  stl:'3d',obj:'3d',
}

function getExt(filename, format) {
  return (filename?.split('.').pop() || format || '').toLowerCase().trim()
}

// ─── DXF Canvas Renderer ──────────────────────────────────────────────────────
function DxfViewer({ url }) {
  const canvasRef = useRef()
  const [msg, setMsg] = useState('Loading DXF…')

  useEffect(() => {
    fetch(url).then(r => r.text()).then(text => {
      try { renderDxf(text); setMsg('') }
      catch(e) { setMsg('Could not render: ' + e.message) }
    }).catch(() => setMsg('Could not load DXF file'))
  }, [url])

  function renderDxf(text) {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx    = canvas.getContext('2d')
    const ents   = parseDxfEntities(text)
    if (!ents.length) { setMsg('No drawable entities found'); return }

    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity
    ents.forEach(e => entityPoints(e).forEach(([x,y]) => {
      if(isFinite(x)&&isFinite(y)){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)}
    }))
    if(!isFinite(minX)){setMsg('No valid geometry');return}

    const W=canvas.width,H=canvas.height
    const scale=Math.min(W/(maxX-minX||1),H/(maxY-minY||1))*0.88
    const offX=W/2-(minX+maxX)/2*scale
    const offY=H/2+(minY+maxY)/2*scale
    const tc=(x,y)=>[x*scale+offX,-y*scale+offY]

    ctx.clearRect(0,0,W,H)
    ctx.fillStyle='#0d1117'; ctx.fillRect(0,0,W,H)
    ctx.strokeStyle='#00e5a0'; ctx.fillStyle='#00e5a0'; ctx.lineWidth=0.8

    ents.forEach(e => {
      ctx.beginPath()
      if(e.type==='LINE'){
        const[x1,y1]=tc(e.x1||0,e.y1||0),[x2,y2]=tc(e.x2||0,e.y2||0)
        ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke()
      }else if(e.type==='CIRCLE'){
        const[cx,cy]=tc(e.x||0,e.y||0),r=(e.r||1)*scale
        ctx.arc(cx,cy,Math.max(r,0.5),0,Math.PI*2);ctx.stroke()
      }else if(e.type==='ARC'){
        const[cx,cy]=tc(e.x||0,e.y||0),r=(e.r||1)*scale
        ctx.arc(cx,cy,Math.max(r,0.5),-(e.endAngle||0)*Math.PI/180,-(e.startAngle||0)*Math.PI/180,true);ctx.stroke()
      }else if((e.type==='POLYLINE'||e.type==='LWPOLYLINE')&&e.vertices?.length){
        const[x0,y0]=tc(e.vertices[0][0],e.vertices[0][1])
        ctx.moveTo(x0,y0)
        e.vertices.slice(1).forEach(([vx,vy])=>{const[px,py]=tc(vx,vy);ctx.lineTo(px,py)})
        if(e.closed)ctx.closePath();ctx.stroke()
      }else if(e.type==='TEXT'||e.type==='MTEXT'){
        const[tx,ty]=tc(e.x||0,e.y||0)
        ctx.font=`${Math.max(8,(e.height||2.5)*scale*0.8)}px monospace`
        ctx.fillText((e.text||'').replace(/\\\\P/g,' ').replace(/[{}]/g,''),tx,ty)
      }else if(e.type==='SPLINE'&&e.vertices?.length){
        const[x0,y0]=tc(e.vertices[0][0],e.vertices[0][1])
        ctx.moveTo(x0,y0)
        e.vertices.forEach(([vx,vy])=>{const[px,py]=tc(vx,vy);ctx.lineTo(px,py)})
        ctx.stroke()
      }
    })
  }

  function parseDxfEntities(text) {
    const lines=text.split(/\r?\n/).map(l=>l.trim()),ents=[]
    let inEnt=false,i=0
    while(i<lines.length){
      if(lines[i]==='0'&&lines[i+1]==='SECTION'&&lines[i+2]==='2'&&lines[i+3]==='ENTITIES'){inEnt=true;i+=4;continue}
      if(inEnt&&lines[i]==='0'&&lines[i+1]==='ENDSEC')break
      if(!inEnt){i++;continue}
      if(lines[i]==='0'){
        const type=lines[i+1]?.toUpperCase();i+=2
        const props={},verts=[]
        while(i<lines.length&&lines[i]!=='0'){
          const code=parseInt(lines[i]),val=lines[i+1];i+=2
          if(isNaN(code))continue
          const isLW=(type==='LWPOLYLINE'||type==='POLYLINE')
          if(code===10){if(isLW)verts.push([parseFloat(val),0]);else{props.x=parseFloat(val);props.x1=parseFloat(val)}}
          else if(code===20){if(isLW){if(verts.length)verts[verts.length-1][1]=parseFloat(val)}else{props.y=parseFloat(val);props.y1=parseFloat(val)}}
          else if(code===11)props.x2=parseFloat(val)
          else if(code===21)props.y2=parseFloat(val)
          else if(code===40){props.r=parseFloat(val);props.height=parseFloat(val)}
          else if(code===50)props.startAngle=parseFloat(val)
          else if(code===51)props.endAngle=parseFloat(val)
          else if(code===70)props.closed=(parseInt(val)&1)===1
          else if(code===1||code===3)props.text=(props.text||'')+(val||'')
        }
        if(verts.length)props.vertices=verts
        if(type&&!['SECTION','TABLE','BLOCK','ENDBLK'].includes(type))ents.push({type,...props})
      }else i++
    }
    return ents
  }

  function entityPoints(e){
    if(e.type==='LINE')return[[e.x1,e.y1],[e.x2,e.y2]]
    if(e.type==='CIRCLE'||e.type==='ARC')return[[e.x||0,e.y||0]]
    if(e.vertices)return e.vertices
    return[[e.x||0,e.y||0]]
  }

  return (
    <div style={{width:'100%',height:'100%',position:'relative',background:'#0d1117'}}>
      {msg&&<div style={{position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',color:'#9ca3af',fontSize:14,textAlign:'center'}}>{msg}</div>}
      <canvas ref={canvasRef} width={1400} height={800} style={{width:'100%',height:'100%'}} />
      <div style={{position:'absolute',top:12,left:12,color:'rgba(255,255,255,0.4)',fontSize:11}}>DXF — native canvas renderer</div>
    </div>
  )
}

// ─── Three.js 3D Viewer ───────────────────────────────────────────────────────
function ThreeDViewer({ url, ext }) {
  const mountRef = useRef()
  const [msg, setMsg] = useState('Loading 3D model…')

  useEffect(() => {
    const el = mountRef.current
    if (!el) return
    let renderer, animId

    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'
    script.onload = () => {
      const THREE = window.THREE
      const W=el.clientWidth, H=el.clientHeight
      renderer = new THREE.WebGLRenderer({ antialias:true })
      renderer.setSize(W,H); renderer.setPixelRatio(window.devicePixelRatio)
      el.appendChild(renderer.domElement)

      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x1a1a2e)
      scene.add(new THREE.GridHelper(200,20,0x444444,0x222222))
      scene.add(new THREE.AmbientLight(0xffffff,0.6))
      const dl=new THREE.DirectionalLight(0xffffff,0.8); dl.position.set(50,100,50); scene.add(dl)
      const dl2=new THREE.DirectionalLight(0x4488ff,0.3); dl2.position.set(-50,-50,-50); scene.add(dl2)

      const camera = new THREE.PerspectiveCamera(45,W/H,0.01,10000)
      let phi=Math.PI/4, theta=0, radius=150, isDown=false, lastX=0, lastY=0
      camera.position.set(radius*0.7,radius*0.5,radius); camera.lookAt(0,0,0)

      renderer.domElement.addEventListener('mousedown', e=>{isDown=true;lastX=e.clientX;lastY=e.clientY})
      renderer.domElement.addEventListener('mouseup', ()=>isDown=false)
      renderer.domElement.addEventListener('mousemove', e=>{
        if(!isDown)return
        theta-=(e.clientX-lastX)*0.01; phi-=(e.clientY-lastY)*0.01
        phi=Math.max(0.05,Math.min(Math.PI-0.05,phi))
        lastX=e.clientX;lastY=e.clientY
        camera.position.set(radius*Math.sin(phi)*Math.sin(theta),radius*Math.cos(phi),radius*Math.sin(phi)*Math.cos(theta))
        camera.lookAt(0,0,0)
      })
      renderer.domElement.addEventListener('wheel', e=>{
        radius=Math.max(1,radius+e.deltaY*0.1)
        camera.position.normalize().multiplyScalar(radius); camera.lookAt(0,0,0)
      })

      function addMesh(geo){
        geo.computeBoundingBox(); geo.center()
        const sz=new THREE.Vector3(); geo.boundingBox.getSize(sz)
        const sf=100/Math.max(sz.x,sz.y,sz.z)
        geo.scale(sf,sf,sf)
        scene.add(new THREE.Mesh(geo,new THREE.MeshPhongMaterial({color:0x4fc3f7,specular:0x222222,shininess:40,side:THREE.DoubleSide})))
        scene.add(new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:0x0d47a1,wireframe:true,opacity:0.12,transparent:true})))
        radius=Math.max(sz.x,sz.y,sz.z)*sf*1.8
        camera.position.set(radius*0.7,radius*0.5,radius); camera.lookAt(0,0,0)
        setMsg('')
      }

      fetch(url).then(r => {
        if(ext==='stl') return r.arrayBuffer().then(buf=>{
          const dv=new DataView(buf),numT=dv.getUint32(80,true),pos=[],norm=[]
          if(numT*50+84===buf.byteLength){
            for(let i=0;i<numT;i++){
              const o=84+i*50,nx=dv.getFloat32(o,true),ny=dv.getFloat32(o+4,true),nz=dv.getFloat32(o+8,true)
              for(let v=0;v<3;v++){const vo=o+12+v*12;pos.push(dv.getFloat32(vo,true),dv.getFloat32(vo+4,true),dv.getFloat32(vo+8,true));norm.push(nx,ny,nz)}
            }
          } else {
            const txt=new TextDecoder().decode(buf)
            const vr=/vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g
            const nr=/facet normal\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g
            const vs=[],ns=[];let m
            while((m=nr.exec(txt)))ns.push([+m[1],+m[2],+m[3]])
            while((m=vr.exec(txt)))vs.push([+m[1],+m[2],+m[3]])
            vs.forEach((v,i)=>{pos.push(...v);norm.push(...(ns[Math.floor(i/3)]||[0,1,0]))})
          }
          const geo=new THREE.BufferGeometry()
          geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3))
          geo.setAttribute('normal',new THREE.Float32BufferAttribute(norm,3))
          addMesh(geo)
        })
        else if(ext==='obj') return r.text().then(txt=>{
          const vs=[],pos=[]
          txt.split('\n').forEach(line=>{
            const p=line.trim().split(/\s+/)
            if(p[0]==='v')vs.push([+p[1],+p[2],+p[3]])
            else if(p[0]==='f'){
              const idx=p.slice(1).map(s=>parseInt(s.split('/')[0])-1)
              for(let i=1;i<idx.length-1;i++){
                if(vs[idx[0]]&&vs[idx[i]]&&vs[idx[i+1]])pos.push(...vs[idx[0]],...vs[idx[i]],...vs[idx[i+1]])
              }
            }
          })
          const geo=new THREE.BufferGeometry()
          geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3))
          geo.computeVertexNormals(); addMesh(geo)
        })
        else setMsg('GLTF/GLB: use Download and open in a 3D viewer')
      }).catch(()=>setMsg('Could not load 3D file'))

      const animate=()=>{animId=requestAnimationFrame(animate);renderer.render(scene,camera)}
      animate()
    }
    document.head.appendChild(script)
    return ()=>{ cancelAnimationFrame(animId); if(renderer&&el.contains(renderer.domElement))el.removeChild(renderer.domElement) }
  }, [url, ext])

  return (
    <div ref={mountRef} style={{width:'100%',height:'100%',position:'relative',cursor:'grab'}}>
      {msg&&<div style={{position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',color:'#9ca3af',fontSize:14,textAlign:'center',zIndex:1,pointerEvents:'none'}}>{msg}</div>}
      <div style={{position:'absolute',top:12,left:12,color:'rgba(255,255,255,0.4)',fontSize:11,zIndex:1,pointerEvents:'none'}}>Drag to rotate · Scroll to zoom</div>
    </div>
  )
}

// ─── PDF Conversion Viewer ────────────────────────────────────────────────────
function PdfConvertViewer({ fileId, token, filename }) {
  const [loaded, setLoaded] = useState(false)
  const pdfUrl = `/api/convert/files/${fileId}/pdf?token=${encodeURIComponent(token)}`

  // Load iframe directly — no probe fetch (probe would log a duplicate view count)
  return (
    <div style={{width:'100%',height:'100%',position:'relative',background:'#111'}}>
      {!loaded && (
        <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',
          alignItems:'center',justifyContent:'center',gap:16,background:'#111',zIndex:1}}>
          <div style={{width:48,height:48,border:'4px solid #185FA5',
            borderTopColor:'transparent',borderRadius:'50%',
            animation:'spin 0.8s linear infinite'}} />
          <div style={{color:'#9ca3af',fontSize:14}}>Converting {filename} to PDF…</div>
          <div style={{color:'#6b7280',fontSize:12}}>This may take a few seconds</div>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}
      <iframe
        src={pdfUrl}
        onLoad={() => setLoaded(true)}
        style={{width:'100%',height:'100%',border:'none'}}
        title={filename}
      />
    </div>
  )
}

// ─── Main FileViewer ───────────────────────────────────────────────────────────
export default function FileViewer({ file, docId, onClose }) {
  const [textContent, setTextContent] = useState('')
  const [textLoading, setTextLoading] = useState(false)

  const token   = localStorage.getItem('dms_token') || ''
  const viewUrl = `/api/documents/${docId}/files/${file.id}/view?token=${encodeURIComponent(token)}`
  const ext     = getExt(file.filename, file.file_format)
  const viewType = NATIVE[ext] || 'convert'  // default to server PDF conversion

  const fileSize = file.file_size ? `${(file.file_size/1024).toFixed(0)} KB` : ''

  useEffect(() => {
    if (viewType !== 'text') return
    setTextLoading(true)
    fetch(viewUrl).then(r=>r.text()).then(setTextContent)
      .catch(()=>setTextContent('Could not load'))
      .finally(()=>setTextLoading(false))
  }, [file.id])

  // Label for header
  const FORMAT_LABELS = {
    pdf:'PDF Document', png:'PNG Image', jpg:'JPEG Image', jpeg:'JPEG Image',
    gif:'GIF Image', bmp:'BMP Image', webp:'WebP Image', svg:'SVG Vector',
    tiff:'TIFF Image', tif:'TIFF Image', txt:'Text File', csv:'CSV Spreadsheet',
    json:'JSON File', xml:'XML File', log:'Log File', mp4:'MP4 Video',
    webm:'WebM Video', ogg:'OGG Video', mp3:'MP3 Audio', wav:'WAV Audio',
    dxf:'DXF CAD Drawing', stl:'STL 3D Model', obj:'OBJ 3D Model',
    docx:'Word Document', doc:'Word Document', xlsx:'Excel Spreadsheet',
    xls:'Excel Spreadsheet', pptx:'PowerPoint', ppt:'PowerPoint',
    dwg:'AutoCAD DWG Drawing', stp:'STEP 3D Model', step:'STEP 3D Model',
    iges:'IGES 3D Model', igs:'IGS 3D Model', gltf:'GLTF 3D Model', glb:'GLB 3D Model',
  }

  return (
    <div style={{position:'fixed',inset:0,zIndex:2000,background:'rgba(0,0,0,0.92)',
      display:'flex',flexDirection:'column'}}>

      {/* Header */}
      <div style={{background:'#0C447C',padding:'10px 20px',flexShrink:0,
        display:'flex',alignItems:'center',gap:14}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{color:'#fff',fontWeight:700,fontSize:14,
            whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
            {file.filename}
          </div>
          <div style={{color:'rgba(255,255,255,0.55)',fontSize:11,marginTop:2}}>
            {FORMAT_LABELS[ext] || ext.toUpperCase()}
            {fileSize && ` · ${fileSize}`}
            {viewType==='convert' && ' · Converting to PDF for preview'}
            {viewType==='dxf'    && ' · Rendered natively (Canvas)'}
            {viewType==='3d'     && ' · Rendered natively (Three.js)'}
          </div>
        </div>
        <a href={`/api/documents/${docId}/files/${file.id}/download?token=${encodeURIComponent(token)}`}
          download={file.filename}
          style={{padding:'6px 14px',borderRadius:7,border:'1px solid rgba(255,255,255,0.4)',
            color:'#fff',fontSize:12,fontWeight:600,textDecoration:'none',
            background:'rgba(255,255,255,0.1)',whiteSpace:'nowrap'}}>
          ⬇ Download
        </a>
        <button onClick={onClose}
          style={{background:'rgba(255,255,255,0.15)',border:'none',color:'#fff',
            fontSize:20,cursor:'pointer',width:34,height:34,borderRadius:'50%',
            display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>×</button>
      </div>

      {/* Viewer */}
      <div style={{flex:1,overflow:'hidden',background:'#111',position:'relative'}}>

        {viewType==='pdf' && (
          <iframe src={viewUrl} style={{width:'100%',height:'100%',border:'none'}} title={file.filename} />
        )}

        {viewType==='image' && (
          <div style={{width:'100%',height:'100%',overflow:'auto',
            display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
            <img src={viewUrl} alt={file.filename}
              style={{maxWidth:'100%',maxHeight:'100%',objectFit:'contain',
                boxShadow:'0 4px 40px rgba(0,0,0,0.6)'}} />
          </div>
        )}

        {viewType==='video' && (
          <div style={{width:'100%',height:'100%',display:'flex',
            alignItems:'center',justifyContent:'center',padding:20}}>
            <video controls style={{maxWidth:'100%',maxHeight:'100%'}}>
              <source src={viewUrl} />
            </video>
          </div>
        )}

        {viewType==='audio' && (
          <div style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',
            alignItems:'center',justifyContent:'center',gap:20}}>
            <div style={{fontSize:60}}>🎵</div>
            <div style={{color:'#fff',fontSize:16,fontWeight:600}}>{file.filename}</div>
            <audio controls style={{width:380}}><source src={viewUrl} /></audio>
          </div>
        )}

        {viewType==='text' && (
          <div style={{width:'100%',height:'100%',overflow:'auto',padding:24}}>
            {textLoading
              ? <div style={{color:'#9ca3af',textAlign:'center',paddingTop:60}}>Loading…</div>
              : <pre style={{color:'#d4d4d4',fontSize:13,lineHeight:1.7,
                  fontFamily:'Consolas,Monaco,monospace',
                  whiteSpace:'pre-wrap',wordBreak:'break-all',margin:0}}>
                  {textContent||'(empty file)'}
                </pre>
            }
          </div>
        )}

        {viewType==='dxf' && <DxfViewer url={viewUrl} />}

        {viewType==='3d' && <ThreeDViewer url={viewUrl} ext={ext} />}

        {/* ALL other formats → server-side PDF conversion */}
        {viewType==='convert' && (
          <PdfConvertViewer
            fileId={file.id}
            token={token}
            filename={file.filename}
          />
        )}
      </div>

      {/* Footer */}
      <div style={{background:'#0a2d52',padding:'6px 20px',flexShrink:0,
        display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div style={{color:'rgba(255,255,255,0.4)',fontSize:11}}>
          {viewType==='convert' && 'Converted to PDF on server · Cached for fast repeat viewing · No external app needed'}
          {viewType==='dxf'    && '2D CAD — lines, arcs, circles, polylines, text rendered on HTML5 Canvas'}
          {viewType==='3d'     && '3D model rendered by Three.js · STL (binary+ASCII) and OBJ supported'}
          {viewType==='pdf'    && 'PDF rendered natively by browser'}
          {viewType==='image'  && 'Image rendered natively'}
          {viewType==='text'   && 'Plain text — no conversion needed'}
          {viewType==='video'  && 'Video played natively by browser'}
          {viewType==='audio'  && 'Audio played natively by browser'}
        </div>
        <button onClick={onClose}
          style={{background:'rgba(255,255,255,0.1)',border:'none',
            color:'rgba(255,255,255,0.6)',cursor:'pointer',fontSize:12,
            padding:'4px 12px',borderRadius:5}}>Close</button>
      </div>
    </div>
  )
}
