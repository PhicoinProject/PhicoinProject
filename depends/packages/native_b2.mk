package=native_b2
$(package)_version=1_74_0
$(package)_download_path=https://archives.boost.io/release/1.74.0/source/
$(package)_file_name=boost_$($(package)_version).tar.gz
$(package)_sha256_hash=afff36d392885120bcac079148c177d1f6f7730ec3d47233aa51b0afa4db94a5
$(package)_build_subdir=tools/build/src/engine
ifneq (,$(findstring clang,$($(package)_cxx)))
$(package)_toolset_$(host_os)=clang
else
$(package)_toolset_$(host_os)=gcc
endif

define $(package)_build_cmds
  CXX="$($(package)_cxx)" CXXFLAGS="$($(package)_cxxflags)" ./build.sh "$($(package)_toolset_$(host_os))"
endef

define $(package)_stage_cmds
  mkdir -p "$($(package)_staging_prefix_dir)"/bin/ && \
  cp b2 "$($(package)_staging_prefix_dir)"/bin/
endef
