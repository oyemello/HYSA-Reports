import { useState } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

type Props = {
  targetId: string;
  filename?: string;
};

const DownloadPDFButton = ({ targetId, filename = 'hysa-dashboard.pdf' }: Props) => {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleDownload = async () => {
    const element = document.getElementById(targetId);
    if (!element) {
      return;
    }
    setIsGenerating(true);
    try {
      const canvas = await html2canvas(element, {
        backgroundColor: '#0f172a',
        scale: window.devicePixelRatio,
      });
      const imageData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'pt', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imageWidth = pageWidth;
      const imageHeight = (canvas.height * imageWidth) / canvas.width;
      let heightLeft = imageHeight;
      let position = 0;

      pdf.addImage(imageData, 'PNG', 0, position, imageWidth, imageHeight, undefined, 'FAST');
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imageHeight;
        pdf.addPage();
        pdf.addImage(imageData, 'PNG', 0, position, imageWidth, imageHeight, undefined, 'FAST');
        heightLeft -= pageHeight;
      }

      const stampedName = filename.replace('.pdf', `-${new Date().toISOString().slice(0, 10)}.pdf`);
      pdf.save(stampedName);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={isGenerating}
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
    >
      {isGenerating ? 'Preparing snapshot…' : 'Download PDF snapshot'}
    </button>
  );
};

export default DownloadPDFButton;
