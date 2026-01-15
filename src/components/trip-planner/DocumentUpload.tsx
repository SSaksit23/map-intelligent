"use client";

import { useState, useRef, useCallback } from "react";
import { Upload, FileText, Image, X, Loader2, CheckCircle, AlertCircle, Plane, Train } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ExtractedFlight {
  flightNumber: string;
  airline?: string;
  departureAirport?: string;
  departureCode: string;
  arrivalAirport?: string;
  arrivalCode: string;
  departureTime?: string;
  arrivalTime?: string;
  day?: number;
}

interface ExtractedTrain {
  trainNumber: string;
  trainType?: "high-speed" | "normal" | "metro" | "other";
  operator?: string;
  departureStation: string;
  arrivalStation: string;
  departureTime?: string;
  arrivalTime?: string;
  day?: number;
}

interface DocumentUploadProps {
  onDataExtracted: (data: {
    locations: Array<{
      name: string;
      description?: string;
      address?: string;
      coordinates: { lat: number; lng: number };
      type: string;
      day?: number;
      order?: number; // Order from crew output for proper sequencing
    }>;
    flights?: ExtractedFlight[];
    trains?: ExtractedTrain[];
    message?: string;
    estimatedDays?: number;
  }) => void;
  isOpen: boolean;
  onClose: () => void;
}

type UploadStatus = "idle" | "uploading" | "processing" | "success" | "error";

export function DocumentUpload({ onDataExtracted, isOpen, onClose }: DocumentUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const acceptedTypes = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/gif",
  ];

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const validateFile = (file: File): boolean => {
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      setErrorMessage("File size must be less than 10MB");
      return false;
    }

    const fileName = file.name.toLowerCase();
    const isValidType =
      acceptedTypes.includes(file.type) ||
      fileName.endsWith(".pdf") ||
      fileName.endsWith(".docx") ||
      fileName.endsWith(".doc") ||
      fileName.endsWith(".png") ||
      fileName.endsWith(".jpg") ||
      fileName.endsWith(".jpeg") ||
      fileName.endsWith(".webp") ||
      fileName.endsWith(".gif");

    if (!isValidType) {
      setErrorMessage("Please upload a PDF, Word document, or image file");
      return false;
    }

    return true;
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    setErrorMessage(null);

    const file = e.dataTransfer.files?.[0];
    if (file && validateFile(file)) {
      setSelectedFile(file);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMessage(null);
    const file = e.target.files?.[0];
    if (file && validateFile(file)) {
      setSelectedFile(file);
    }
  }, []);

  const handleUpload = async () => {
    if (!selectedFile) return;

    setStatus("uploading");
    setErrorMessage(null);
    setResultMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      setStatus("processing");

      const response = await fetch("/api/extract-document", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to process document");
      }

      const data = await response.json();

      const locationCount = data.locations?.length || 0;
      const flightCount = data.flights?.length || 0;
      const trainCount = data.trains?.length || 0;
      const totalCount = locationCount + flightCount + trainCount;

      if (totalCount > 0) {
        setStatus("success");
        
        // Build result message
        const parts: string[] = [];
        if (locationCount > 0) parts.push(`${locationCount} location(s)`);
        if (flightCount > 0) parts.push(`${flightCount} flight(s)`);
        if (trainCount > 0) parts.push(`${trainCount} train(s)`);
        
        setResultMessage(`Found ${parts.join(", ")} in the document!`);
        
        // Wait a moment to show success, then call the callback
        setTimeout(() => {
          onDataExtracted(data);
          handleClose();
        }, 1500);
      } else {
        setStatus("error");
        setErrorMessage(data.message || "No travel information found in the document");
      }
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Failed to process document");
    }
  };

  const handleClose = () => {
    setSelectedFile(null);
    setStatus("idle");
    setErrorMessage(null);
    setResultMessage(null);
    onClose();
  };

  const getFileIcon = (file: File) => {
    if (file.type.startsWith("image/")) {
      return <Image className="size-8 text-violet-500" />;
    }
    return <FileText className="size-8 text-blue-500" />;
  };

  const getFileTypeLabel = (file: File) => {
    const fileName = file.name.toLowerCase();
    if (file.type === "application/pdf" || fileName.endsWith(".pdf")) return "PDF";
    if (file.type.includes("wordprocessingml") || fileName.endsWith(".docx")) return "Word";
    if (file.type === "application/msword" || fileName.endsWith(".doc")) return "Word (Legacy)";
    if (file.type.startsWith("image/")) return "Image";
    return "Document";
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />
      
      {/* Modal */}
      <div className="relative bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center">
              <Upload className="size-5 text-white" />
            </div>
            <div>
              <h2 className="font-semibold">Upload Document</h2>
              <p className="text-xs text-muted-foreground">Extract locations, flights & trains from your itinerary</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {/* Drop Zone */}
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`
              relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer
              transition-all duration-200
              ${dragActive 
                ? "border-violet-500 bg-violet-500/10" 
                : "border-border/50 hover:border-border hover:bg-accent/30"
              }
              ${selectedFile ? "border-green-500/50 bg-green-500/5" : ""}
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.webp,.gif"
              onChange={handleFileSelect}
              className="hidden"
            />

            {selectedFile ? (
              <div className="flex flex-col items-center gap-3">
                {getFileIcon(selectedFile)}
                <div>
                  <p className="font-medium text-sm truncate max-w-[250px]">
                    {selectedFile.name}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {getFileTypeLabel(selectedFile)} • {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedFile(null);
                    setStatus("idle");
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Change file
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="size-16 rounded-full bg-violet-500/10 flex items-center justify-center">
                  <Upload className="size-8 text-violet-500" />
                </div>
                <div>
                  <p className="font-medium">Drop your file here or click to browse</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Supports PDF, Word (.docx), and images
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Supported formats info */}
          <div className="flex items-center justify-center gap-4 mt-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <FileText className="size-3" /> PDF
            </span>
            <span className="flex items-center gap-1">
              <FileText className="size-3" /> Word
            </span>
            <span className="flex items-center gap-1">
              <Image className="size-3" /> Images
            </span>
          </div>

          {/* Status Messages */}
          {errorMessage && (
            <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2">
              <AlertCircle className="size-4 text-red-500 flex-shrink-0" />
              <p className="text-sm text-red-500">{errorMessage}</p>
            </div>
          )}

          {resultMessage && status === "success" && (
            <div className="mt-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center gap-2">
              <CheckCircle className="size-4 text-green-500 flex-shrink-0" />
              <p className="text-sm text-green-500">{resultMessage}</p>
            </div>
          )}

          {/* Processing status */}
          {(status === "uploading" || status === "processing") && (
            <div className="mt-4 p-3 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center gap-2">
              <Loader2 className="size-4 text-violet-500 animate-spin flex-shrink-0" />
              <p className="text-sm text-violet-500">
                {status === "uploading" ? "Uploading document..." : "Extracting travel data with AI..."}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-border/50 bg-accent/20">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={status === "uploading" || status === "processing"}
          >
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!selectedFile || status === "uploading" || status === "processing" || status === "success"}
            className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700"
          >
            {status === "uploading" || status === "processing" ? (
              <>
                <Loader2 className="size-4 animate-spin mr-2" />
                Processing...
              </>
            ) : (
              <>
                <Upload className="size-4 mr-2" />
                Extract Data
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
