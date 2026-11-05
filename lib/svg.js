const {DOMParser,XMLSerializer,onWarningStopParsing} = require('@xmldom/xmldom');
// Rebuild a deliberately small, inert SVG vocabulary. No scripts, CSS, links,
// images, animation, entities or embedded documents reach storage.
module.exports = function sanitizeSvg(bytes) {
  const source=bytes.toString('utf8').replace(/^\uFEFF/,'').replace(/^\s*<\?xml[^?]*\?>/,'');
  if(/<!DOCTYPE|<!ENTITY|<\?/i.test(source))throw new Error('SVG: внешние сущности и инструкции запрещены');
  const parsed=new DOMParser({onError:onWarningStopParsing}).parseFromString(source,'image/svg+xml');
  const namespace='http://www.w3.org/2000/svg';
  const allowedTags=new Set('svg g path rect circle ellipse line polyline polygon text tspan defs clipPath linearGradient radialGradient stop title desc'.split(' '));
  const allowedAttrs=new Set('id width height viewBox preserveAspectRatio x y x1 y1 x2 y2 cx cy r rx ry d points fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset stroke-opacity opacity transform font-size font-family font-weight text-anchor dominant-baseline dx dy offset stop-color stop-opacity gradientUnits gradientTransform spreadMethod clip-path clip-rule'.split(' '));
  const result=new DOMParser().parseFromString(`<svg xmlns="${namespace}"/>`,'image/svg+xml');
  let count=0;
  function copy(node,depth=0){
    if(++count>20000||depth>60)throw new Error('SVG: схема слишком сложная');
    if(node.nodeType===3)return result.createTextNode(node.data);
    if(node.nodeType===8)return null;
    if(node.nodeType!==1||!allowedTags.has(node.nodeName)||(node.namespaceURI&&node.namespaceURI!==namespace))throw new Error('SVG: неподдерживаемый элемент; экспортируйте схему в PNG');
    const clean=result.createElementNS(namespace,node.nodeName);
    for(let i=0;i<node.attributes.length;i++){
      const a=node.attributes.item(i);
      if(a.name==='xmlns'&&a.value===namespace)continue;
      if(!allowedAttrs.has(a.name))throw new Error('SVG: стили, события и внешние ссылки запрещены; экспортируйте в PNG');
      if(/url\s*\(/i.test(a.value)&&!/^url\(#[A-Za-z_][\w.-]*\)$/.test(a.value))throw new Error('SVG: разрешены только внутренние ссылки на градиенты/контуры');
      clean.setAttribute(a.name,a.value);
    }
    for(let child=node.firstChild;child;child=child.nextSibling){const safe=copy(child,depth+1);if(safe)clean.appendChild(safe);}
    return clean;
  }
  if(parsed.documentElement?.nodeName!=='svg')throw new Error('SVG: отсутствует корневой элемент svg');
  const clean=copy(parsed.documentElement);clean.setAttribute('xmlns',namespace);
  return Buffer.from(new XMLSerializer().serializeToString(clean),'utf8');
};
